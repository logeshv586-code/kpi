from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker


class Settings(BaseSettings):
    # Local development should use PostgreSQL instance. Docker and production deployments provide
    # DATABASE_URL explicitly and therefore continue to use PostgreSQL.
    database_url: str = "postgresql+psycopg2://kpi:eagle123@localhost:5432/kpi_db"
    secret_key: str = "dev-secret-change-me-please-use-32-plus-characters"
    access_token_expire_minutes: int = 720
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://192.168.1.85:5173,http://localhost:8080,http://127.0.0.1:8080,http://192.168.1.85:8080"

    # Company email gateway. Keep all credentials in .env / deployment secrets;
    # they must never be sent to or stored by the React frontend.
    email_notifications_enabled: bool = True
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "no-reply@example.com"
    smtp_from_name: str = "KPI Performance Management"
    smtp_use_tls: bool = True
    smtp_use_ssl: bool = False
    smtp_timeout_seconds: int = 15

    frontend_url: str = "http://localhost:5173"
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
connect_args = {"check_same_thread": False} if settings.database_url.startswith("sqlite") else {}
engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
