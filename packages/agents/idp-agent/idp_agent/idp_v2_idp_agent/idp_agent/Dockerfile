FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

# Copy bundled package
COPY --from=workspace dist/packages/agents/idp-agent/idp_agent/bundle-arm /app

EXPOSE 8080

ENV PYTHONPATH=/app

# Auto-instrument with AWS Distro for OpenTelemetry
# https://aws-otel.github.io/docs/getting-started/python-sdk/auto-instr
CMD ["python", "bin/opentelemetry-instrument", "python", "-m", "idp_v2_idp_agent.idp_agent.main"]
