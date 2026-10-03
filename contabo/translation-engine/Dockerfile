FROM python:3.12.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    PORT=8792 \
    ASTERA_TRANSLATION_BIND=127.0.0.1 \
    ASTERA_TRANSLATION_MODEL_PATH=/models/madlad400-3b-mt-ct2

WORKDIR /app
COPY contabo/translation-engine/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt \
    && useradd --system --uid 10002 --create-home translation

COPY contabo/translation-engine/quality.py ./quality.py
COPY contabo/translation-engine/app.py ./app.py

USER translation
EXPOSE 8792
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8792/health', timeout=4).read()"
CMD ["python", "app.py"]
