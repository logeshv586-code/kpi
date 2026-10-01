from app.file_storage import (
    UPLOAD_EXTENSIONS,
    CONTENT_TYPES,
    parse_file_ids,
    upload_metadata,
    upload_metadatas,
    validate_extension,
)
from app.models import KpiItem, KpiResponse
from app.schemas import ResponseIn


def test_file_extensions_and_content_types():
    expected_exts = {".pdf", ".xlsx", ".xls", ".csv", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".doc", ".docx", ".txt"}
    for ext in expected_exts:
        assert ext in UPLOAD_EXTENSIONS, f"{ext} should be in UPLOAD_EXTENSIONS"
        assert ext in CONTENT_TYPES, f"{ext} should be in CONTENT_TYPES"
        assert validate_extension(f"sample{ext}") == ext

    failed = False
    try:
        validate_extension("malicious.exe")
    except Exception:
        failed = True
    assert failed, "Executable should be rejected"


def test_parse_file_ids_multiple():
    id1 = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
    id2 = "1234567890abcdef1234567890abcdef"
    
    # Single ID
    assert parse_file_ids(id1) == [id1]
    
    # Comma-separated IDs
    assert parse_file_ids(f"{id1},{id2}") == [id1, id2]
    
    # List of IDs
    assert parse_file_ids([id1, id2]) == [id1, id2]
    
    # None or empty
    assert parse_file_ids(None) == []
    assert parse_file_ids("") == []


def test_response_in_with_multiple_evidence():
    id1 = "a1b2c3d4e5f60718293a4b5c6d7e8f90"
    id2 = "1234567890abcdef1234567890abcdef"
    r = ResponseIn(
        kpi_item_id=1,
        actual_numeric=10,
        manager_actual_numeric=8,
        evidence_file_id=f"{id1},{id2}",
        evidence_file_ids=[id1, id2],
    )
    assert r.actual_numeric == 10
    assert r.manager_actual_numeric == 8
    assert r.evidence_file_ids == [id1, id2]


if __name__ == "__main__":
    test_file_extensions_and_content_types()
    test_parse_file_ids_multiple()
    test_response_in_with_multiple_evidence()
    print("ALL EVIDENCE AND TARGET LIMIT TESTS PASSED")
