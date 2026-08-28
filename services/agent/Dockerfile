# Build context = services/agent
FROM python:3.11-slim AS runtime
WORKDIR /app
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1

RUN groupadd -r praxis && useradd -r -g praxis praxis

COPY requirements.txt ./
RUN pip install -r requirements.txt

COPY praxis_agent ./praxis_agent
COPY pyproject.toml ./

USER praxis
EXPOSE 8081
HEALTHCHECK --interval=15s --timeout=3s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8081/healthz').status==200 else 1)"
CMD ["python", "-m", "praxis_agent.server"]
