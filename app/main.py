from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import __version__
from app.schemas import AggregateRequest, FLSMRequest, VLSMRequest
from app.services import NetworkError, aggregate_networks, calculate_flsm, calculate_vlsm

app = FastAPI(
    title="NetSegment API",
    version=__version__,
    description="Planificacion IPv4 mediante FLSM, VLSM y agregacion CIDR exacta.",
)

FRONTEND = Path(__file__).resolve().parents[1] / "frontend"
app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")


@app.get("/", include_in_schema=False)
def frontend():
    return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-cache"})


@app.exception_handler(NetworkError)
async def network_error_handler(request: Request, error: NetworkError):
    return JSONResponse(status_code=400, content={
        "status": "error",
        "error_code": error.code,
        "message": error.message,
    })


@app.get("/health", tags=["Estado"])
def health():
    return {"status": "ok", "version": __version__}


@app.post("/api/v1/subnetting/flsm", tags=["Subnetting"])
def flsm(request: FLSMRequest):
    return {"status": "success", "data": calculate_flsm(request)}


@app.post("/api/v1/subnetting/vlsm", tags=["Subnetting"])
def vlsm(request: VLSMRequest):
    return {"status": "success", "data": calculate_vlsm(request)}


@app.post("/api/v1/supernetting/aggregate", tags=["Supernetting"])
def aggregate(request: AggregateRequest):
    return {"status": "success", "data": aggregate_networks(request)}
