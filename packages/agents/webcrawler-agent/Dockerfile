FROM public.ecr.aws/docker/library/python:3.13-slim

WORKDIR /app

# Copy project files
COPY pyproject.toml README.md ./
COPY *.py ./
COPY agents ./agents

# Install dependencies
RUN pip install --no-cache-dir .

EXPOSE 8080

# Auto-instrument with AWS Distro for OpenTelemetry
CMD ["opentelemetry-instrument", "python", "-m", "main"]
