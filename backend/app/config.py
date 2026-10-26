from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://poultry:poultry@localhost:5432/poultry"
    jwt_secret: str = "dev-secret-change-me"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30
    # Workers may stay offline for long periods; the refresh token is renewed on every sync.
    refresh_token_days: int = 30
    farm_timezone: str = "Asia/Makassar"
    cors_origins: list[str] = ["http://localhost:5173", "http://localhost:4173"]


settings = Settings()
