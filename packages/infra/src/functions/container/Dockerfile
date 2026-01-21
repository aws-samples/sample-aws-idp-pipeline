FROM --platform=linux/amd64 public.ecr.aws/lambda/python:3.12

COPY requirements.txt ${LAMBDA_TASK_ROOT}/

RUN pip install --no-cache-dir -r requirements.txt

COPY handlers/ ${LAMBDA_TASK_ROOT}/handlers/
RUN chmod -R 755 ${LAMBDA_TASK_ROOT}/handlers/

CMD ["handlers.lancedb_service.handler"]
