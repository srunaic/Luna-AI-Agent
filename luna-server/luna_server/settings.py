import os
from pathlib import Path
BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = "django-insecure-key"
DEBUG = True
ALLOWED_HOSTS = ["*"]
INSTALLED_APPS = ["django.contrib.admin","django.contrib.auth","django.contrib.contenttypes","django.contrib.sessions","django.contrib.messages","django.contrib.staticfiles","rest_framework","corsheaders","packages","memory"]
MIDDLEWARE = ["corsheaders.middleware.CorsMiddleware","django.middleware.security.SecurityMiddleware","django.contrib.sessions.middleware.SessionMiddleware","django.middleware.common.CommonMiddleware","django.middleware.csrf.CsrfViewMiddleware","django.contrib.auth.middleware.AuthenticationMiddleware","django.contrib.messages.middleware.MessageMiddleware","django.middleware.clickjacking.XFrameOptionsMiddleware"]
ROOT_URLCONF = "luna_server.urls"
TEMPLATES = [{"BACKEND": "django.template.backends.django.DjangoTemplates","DIRS": [],"APP_DIRS": True,"OPTIONS": {"context_processors": ["django.template.context_processors.debug","django.template.context_processors.request","django.contrib.auth.context_processors.auth","django.contrib.messages.context_processors.messages"]}}]
WSGI_APPLICATION = "luna_server.wsgi.application"
DATABASES = {"default": {"ENGINE": "django.db.backends.sqlite3","NAME": BASE_DIR / "db.sqlite3"}}
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True
STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
CORS_ALLOW_ALL_ORIGINS = True
MEDIA_URL = "/media/"
MEDIA_ROOT = os.path.join(BASE_DIR, "media")


# ---- Luna Memory (ChromaDB) ----
# Default: local persistent ChromaDB.
LUNA_CHROMA_MODE = os.environ.get("LUNA_CHROMA_MODE", "local").lower()
LUNA_CHROMA_PATH = os.environ.get("LUNA_CHROMA_PATH", str(BASE_DIR / "chroma_db"))
LUNA_CHROMA_COLLECTION = os.environ.get("LUNA_CHROMA_COLLECTION", "luna_memory")
LUNA_CHROMA_HTTP_URL = os.environ.get("LUNA_CHROMA_HTTP_URL", "")
LUNA_CHROMA_AUTH_TOKEN = os.environ.get("LUNA_CHROMA_AUTH_TOKEN", "")

# ---- Admin access (for memory DB inspection/edit) ----
# If LUNA_ADMIN_TOKEN is set, requests must include header:
#   X-Luna-Admin-Token: <token>
# If empty, admin endpoints are restricted to localhost only.
LUNA_ADMIN_TOKEN = os.environ.get("LUNA_ADMIN_TOKEN", "").strip()
LUNA_ADMIN_ALLOW_LOCALHOST = os.environ.get("LUNA_ADMIN_ALLOW_LOCALHOST", "1") not in ("0", "false", "False")
