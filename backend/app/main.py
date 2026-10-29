from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import auth, conflicts, flocks, health, houses, photos, records, sync, users

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
app.include_router(records.router)
app.include_router(sync.router)
app.include_router(conflicts.router)
app.include_router(photos.router)
app.include_router(health.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
