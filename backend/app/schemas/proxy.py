from pydantic import BaseModel, Field


class ProxyItem(BaseModel):
    id: int
    name: str
    proxy_type: str
    host: str
    port: int
    username: str = ""
    password_set: bool = False
    secret_set: bool = False
    enabled: bool = True
    last_check_status: str | None = None
    last_check_at: str | None = None
    last_check_message: str = ""
    assigned_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None
    password: str | None = None
    secret: str | None = None


class ProxyListData(BaseModel):
    database_enabled: bool
    total: int
    proxies: list[ProxyItem]


class ProxyCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    proxy_type: str = Field(default="socks5", max_length=16)
    host: str = Field(min_length=1, max_length=255)
    port: int = Field(ge=1, le=65535)
    username: str | None = None
    password: str | None = None
    secret: str | None = None
    enabled: bool = True


class ProxyUpdateRequest(BaseModel):
    name: str | None = Field(default=None, max_length=128)
    proxy_type: str | None = Field(default=None, max_length=16)
    host: str | None = Field(default=None, max_length=255)
    port: int | None = Field(default=None, ge=1, le=65535)
    username: str | None = None
    password: str | None = None
    secret: str | None = None
    enabled: bool | None = None


class ProxyAssignRequest(BaseModel):
    proxy_id: int | None = None


class ProxyBulkAssignRequest(BaseModel):
    """Bulk assign proxies to phones.

    - mode=same (default): every phone gets proxy_id (or None to clear).
    - mode=round_robin: phones are paired with proxy_ids (or all enabled)
      in rotation so each account can get a different proxy quickly.
    """

    phones: list[str] = Field(min_length=1)
    proxy_id: int | None = None
    mode: str = Field(default="same", max_length=32)
    proxy_ids: list[int] | None = None


class ProxyAssignmentItem(BaseModel):
    phone: str
    proxy_id: int | None = None
    proxy_name: str | None = None
    proxy_type: str | None = None
    proxy_host: str | None = None
    proxy_port: int | None = None


class ProxyAssignmentsData(BaseModel):
    database_enabled: bool
    assignments: list[ProxyAssignmentItem]


class ProxyCheckData(BaseModel):
    id: int
    status: str
    message: str
    last_check_at: str | None = None
