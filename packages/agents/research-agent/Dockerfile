FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

# Copy project files
COPY pyproject.toml README.md ./
COPY *.py ./

# Install dependencies
RUN pip install --no-cache-dir .

EXPOSE 8080

# Auto-instrument with AWS Distro for OpenTelemetry
# https://aws-otel.github.io/docs/getting-started/python-sdk/auto-instr
CMD ["opentelemetry-instrument", "python", "-m", "main"]
