from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite+aiosqlite:///./claudeflow.db"

    SCHWAB_CLIENT_ID: str = ""
    SCHWAB_CLIENT_SECRET: str = ""
    SCHWAB_REDIRECT_URI: str = "https://127.0.0.1:8182"
    SCHWAB_TOKEN_PATH: str = "./schwab_token.json"

    POLYGON_API_KEY: str = "1GjPoGKFpJcyP7sCUxGACkW0T94NyeWY"

    ANTHROPIC_API_KEY: str = ""

    ROBINHOOD_USERNAME: str = ""
    ROBINHOOD_PASSWORD: str = ""
    ROBINHOOD_MFA_CODE: str = ""

    SECRET_KEY: str = "change-me"
    CORS_ORIGINS: str = "http://localhost:5173"

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",")]

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
