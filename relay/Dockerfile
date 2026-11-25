FROM python:3.12-slim
WORKDIR /app
COPY relay/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY relay /app/relay
RUN useradd --create-home appuser
USER appuser
ENV PORT=8080
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT} --workers 1 --threads 4 --timeout 130 --access-logfile /dev/null relay.wsgi:app"]
