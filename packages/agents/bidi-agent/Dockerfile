FROM public.ecr.aws/docker/library/python:3.13-slim

# Ensure Python output is sent straight to terminal without buffering
ENV PYTHONUNBUFFERED=1

WORKDIR /app

# Install audio libraries and build tools for pyaudio
RUN apt-get update && apt-get install -y --no-install-recommends \
    portaudio19-dev \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy project files
COPY pyproject.toml README.md ./
COPY *.py ./

# Install dependencies
RUN pip install --no-cache-dir .

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080", "--ws-ping-interval", "2", "--ws-ping-timeout", "10"]
