from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import auth, flocks, houses, users

app = FastAPI(title="Poultry Farm MIS API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(houses.router)
app.include_router(flocks.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
