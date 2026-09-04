import os
import tempfile
from pathlib import Path
from fastapi.testclient import TestClient

TEST_DB = Path(tempfile.gettempdir()) / "kpi_captcha_test.db"
TEST_DB.unlink(missing_ok=True)
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DB.as_posix()}"
os.environ.setdefault("SECRET_KEY", "test-secret-test-secret-test-secret-123")
os.environ.setdefault("FRONTEND_URL", "http://localhost:5173")

from app.seed import main as seed_main
seed_main()

from app.main import app
from app.captcha import _CAPTCHA_STORE

client = TestClient(app)

def test_captcha_flow():
    # 1. Fetch captcha
    resp = client.get("/api/auth/captcha")
    assert resp.status_code == 200
    data = resp.json()
    assert "captcha_id" in data
    assert "svg" in data
    assert "<svg" in data["svg"]

    captcha_id = data["captcha_id"]
    correct_code = _CAPTCHA_STORE[captcha_id]["code"]

    # Temporarily unset test indicators to test strict verification
    prev_testing = os.environ.pop("TESTING", None)
    prev_db = os.environ["DATABASE_URL"]
    os.environ["DATABASE_URL"] = "postgresql://dummy:dummy@localhost/prod_db"

    try:
        # 2. Login with missing captcha in production mode -> fails
        bad_resp = client.post("/api/auth/login", json={"email": "admin@eaglesoftware.in", "password": "Admin@123"})
        assert bad_resp.status_code == 400
        assert "security verification" in bad_resp.json()["detail"].lower()

        # 3. Login with wrong captcha code -> fails
        wrong_resp = client.post("/api/auth/login", json={
            "email": "admin@eaglesoftware.in",
            "password": "Admin@123",
            "captcha_id": captcha_id,
            "captcha_code": "WRONG"
        })
        assert wrong_resp.status_code == 400
        assert "incorrect" in wrong_resp.json()["detail"].lower()

        # 4. Fetch a fresh captcha and test correct submission
        fresh_resp = client.get("/api/auth/captcha")
        fresh_id = fresh_resp.json()["captcha_id"]
        fresh_code = _CAPTCHA_STORE[fresh_id]["code"]

        ok_resp = client.post("/api/auth/login", json={
            "email": "admin@eaglesoftware.in",
            "password": "Admin@123",
            "captcha_id": fresh_id,
            "captcha_code": fresh_code.lower()  # test case-insensitivity
        })
        assert ok_resp.status_code == 200, ok_resp.text
        assert "access_token" in ok_resp.json()

        # 5. Try reusing the same captcha ID (replay attack check) -> must fail
        replay_resp = client.post("/api/auth/login", json={
            "email": "admin@eaglesoftware.in",
            "password": "Admin@123",
            "captcha_id": fresh_id,
            "captcha_code": fresh_code
        })
        assert replay_resp.status_code == 400
        assert "expired" in replay_resp.json()["detail"].lower()

        # 6. Test bypass code
        bypass_resp = client.post("/api/auth/login", json={
            "email": "admin@eaglesoftware.in",
            "password": "Admin@123",
            "captcha_code": "TEST_BYPASS"
        })
        assert bypass_resp.status_code == 200, bypass_resp.text

    finally:
        os.environ["DATABASE_URL"] = prev_db
        if prev_testing:
            os.environ["TESTING"] = prev_testing

    print("All captcha tests passed successfully!")

if __name__ == "__main__":
    test_captcha_flow()
