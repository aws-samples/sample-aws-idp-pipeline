FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

# Install officecli (Office document CLI used by the officecli skill) plus
# chromium, which officecli uses as its headless renderer for `view screenshot`.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates libicu76 chromium fonts-noto-cjk \
    && curl -fsSL https://d.officecli.ai/install.sh | bash \
    && mv "$HOME/.local/bin/officecli" /usr/local/bin/officecli \
    && apt-get purge -y curl \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*
RUN officecli --version

# Copy project files
COPY pyproject.toml README.md ./
COPY *.py ./
COPY agents/ ./agents/
COPY tools/ ./tools/
COPY .skills/ ./.skills/

# Install dependencies
RUN pip install --no-cache-dir .

EXPOSE 8080

# Auto-instrument with AWS Distro for OpenTelemetry
# https://aws-otel.github.io/docs/getting-started/python-sdk/auto-instr
CMD ["opentelemetry-instrument", "python", "-m", "main"]
