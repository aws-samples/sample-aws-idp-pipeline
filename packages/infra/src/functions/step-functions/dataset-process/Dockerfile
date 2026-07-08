FROM public.ecr.aws/docker/library/python:3.13-slim

# DuckDB writes its home/extensions under HOME; Lambda only allows /tmp.
ENV HOME=/tmp

# Lambda Runtime Interface Client
RUN pip install --no-cache-dir awslambdaric

WORKDIR /var/task

COPY step-functions/dataset-process/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Shared modules (ddb_client, etc.)
COPY shared/ ./shared/

# Handler + helpers
COPY step-functions/dataset-process/index.py .
COPY step-functions/dataset-process/validator.py .
COPY step-functions/dataset-process/reference.py .

ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["index.handler"]
