"""Deployment entry point. No infrastructure is created; invalid config fails closed."""
from .app import from_environment
app=from_environment()
