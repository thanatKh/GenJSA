"""Error handling — users must see easy-to-understand Thai messages, never a traceback.

Principle: every error that reaches the user must go through an AppError with a
pre-written Thai message. Never leak server-side details (model name, URL,
traceback) into the response.
"""

import logging

from fastapi import Request
from fastapi.responses import JSONResponse

logger = logging.getLogger("genjsa")


class AppError(Exception):
    """An error that is intentionally shown to the user."""

    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        self.code = code
        self.message = message
        self.status_code = status_code
        super().__init__(message)


# All user-facing Thai messages live here, in one place
class Errors:
    AI_TIMEOUT = AppError(
        "ai_timeout",
        "ระบบ AI ตอบกลับช้ากว่าปกติ ข้อมูลของคุณยังอยู่ กดลองอีกครั้งได้เลย",
        504,
    )
    AI_RATE_LIMIT = AppError(
        "ai_rate_limit",
        "มีการใช้งานพร้อมกันจำนวนมาก กรุณารอสักครู่แล้วลองอีกครั้ง",
        429,
    )
    AI_UNAVAILABLE = AppError(
        "ai_unavailable",
        "ไม่สามารถเชื่อมต่อระบบ AI ได้ในขณะนี้ ข้อมูลของคุณยังอยู่ กรุณาลองอีกครั้งในอีกสักครู่",
        503,
    )
    AI_BAD_RESPONSE = AppError(
        "ai_bad_response",
        "ระบบ AI ตอบกลับในรูปแบบที่อ่านไม่ได้ กรุณากดลองอีกครั้ง "
        "หากยังไม่ได้ ลองเพิ่มรายละเอียดงานให้ชัดเจนขึ้น",
        502,
    )
    AI_AUTH = AppError(
        "ai_auth",
        "การเชื่อมต่อระบบ AI ไม่ได้รับอนุญาต กรุณาแจ้งผู้ดูแลระบบ",
        502,
    )
    INVALID_INPUT = AppError(
        "invalid_input",
        "ข้อมูลที่กรอกไม่ครบหรือไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง",
        422,
    )
    TOO_MANY_REQUESTS = AppError(
        "too_many_requests",
        "คุณส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองอีกครั้ง",
        429,
    )
    PAYLOAD_TOO_LARGE = AppError(
        "payload_too_large",
        "ข้อมูลที่ส่งมามีขนาดใหญ่เกินไป กรุณาลดความยาวข้อความแล้วลองอีกครั้ง",
        413,
    )
    INTERNAL = AppError(
        "internal",
        "เกิดข้อผิดพลาดภายในระบบ กรุณาลองอีกครั้ง",
        500,
    )


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    # Log the code only — never log JSA content or payload, per the privacy requirement
    logger.warning("AppError: %s", exc.code)
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
    )


async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    """Last-resort safety net — nothing unexpected should ever leak a traceback to the user.

    Log only the exception type, never the message, since the message may
    carry JSA content along with it.
    """
    logger.error("Unhandled %s", type(exc).__name__)
    return JSONResponse(
        status_code=Errors.INTERNAL.status_code,
        content={
            "error": {
                "code": Errors.INTERNAL.code,
                "message": Errors.INTERNAL.message,
            }
        },
    )
