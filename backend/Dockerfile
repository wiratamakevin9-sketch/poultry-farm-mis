FROM python:3.13-slim
RUN pip install --no-cache-dir uv==0.11.32
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && if [ \"$SEED_DEV_DATA\" = 1 ]; then python -m app.seed; fi && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
