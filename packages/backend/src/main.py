from pydantic import BaseModel

from .init import app, lambda_handler, tracer

handler = lambda_handler


class PingOutput(BaseModel):
    message: str


@app.get("/ping")
@tracer.capture_method
def ping() -> PingOutput:
    return PingOutput(message="pong")
