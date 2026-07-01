import logging

from authlib.integrations.starlette_client import OAuth
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, RedirectResponse

from app.config import settings
from app.services.database import get_or_create_user, get_user_by_id

logger = logging.getLogger(__name__)

router = APIRouter()

oauth = OAuth()
oauth.register(
    name="google",
    client_id=settings.google_client_id,
    client_secret=settings.google_client_secret,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


@router.get("/auth/login")
async def login(request: Request):
    redirect_uri = request.url_for("auth_callback")
    return await oauth.google.authorize_redirect(request, redirect_uri)


@router.get("/auth/callback")
async def auth_callback(request: Request):
    token = await oauth.google.authorize_access_token(request)
    userinfo = token.get("userinfo", {})
    email = userinfo.get("email", "")
    name = userinfo.get("name", "")
    picture = userinfo.get("picture", "")

    if not email:
        return JSONResponse({"error": "No email in Google response"}, status_code=400)

    user = await get_or_create_user(email, name, picture)
    request.session["user_id"] = user["id"]
    logger.info("User logged in: %s (%s)", email, user["id"])
    return RedirectResponse("/")


@router.post("/auth/logout")
async def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/api/me")
async def get_me(request: Request):
    user_id = request.session.get("user_id")
    if not user_id:
        return JSONResponse({"error": "Not authenticated"}, status_code=401)
    user = await get_user_by_id(user_id)
    if not user:
        request.session.clear()
        return JSONResponse({"error": "User not found"}, status_code=401)
    return {
        "id": user["id"],
        "email": user["email"],
        "name": user["name"],
        "picture": user["picture"],
    }
