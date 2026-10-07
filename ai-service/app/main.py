from datetime import datetime, timezone

from fastapi import FastAPI

app = FastAPI(title="Hearing Assist AI Service", version="0.1.0")


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "code": 0,
        "message": "ok",
        "data": {
            "service": "ai-service",
            "status": "ok",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    }
