FROM python:3.12-slim

# LibreOffice for PPT/DOCX to PDF conversion + CJK fonts
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        libreoffice-impress \
        libreoffice-writer \
        fonts-noto-cjk \
        fonts-nanum && \
    fc-cache -f && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# LibreOffice needs writable HOME for user profile (Lambda only has /tmp)
ENV HOME=/tmp

# Lambda Runtime Interface Client
RUN pip install --no-cache-dir awslambdaric

WORKDIR /var/task

COPY step-functions/format-parser/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Shared modules
COPY shared/ ./shared/

# Handler
COPY step-functions/format-parser/index.py .

ENTRYPOINT ["python", "-m", "awslambdaric"]
CMD ["index.handler"]
