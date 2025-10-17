FROM python:3.11-alpine

WORKDIR /app

# Copy the Python runner script
COPY python-runner.py /app/python-runner.py

# Set resource limits (optional, can be overridden at runtime)
# These are defaults but can be customized per container
ENV PYTHONUNBUFFERED=1

# Run the Python runner
ENTRYPOINT ["python3", "/app/python-runner.py"]

