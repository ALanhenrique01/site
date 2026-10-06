import os
import hmac
import sqlite3
import hashlib
import secrets
from datetime import datetime, date, timedelta
from typing import Optional, List
from fastapi import FastAPI, HTTPException, Depends, Header, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

app = FastAPI(title="ANA CAROLINA BEAUTY - Designer de Sobrancelhas", docs_url=None, redoc_url=None, openapi_url=None)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_FILE = os.environ.get("DB_FILE", os.path.join(BASE_DIR, "database.db"))
SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))

def get_db():
    conn = sqlite3.connect(DB_FILE)
    conn.row_factory = sqlite3.Row
    return conn

def legacy_hash(password: str) -> str:
    return hashlib.sha256(password.encode("utf-8")).hexdigest()

def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode(), 200_000).hex()
    return f"pbkdf2${salt}${digest}"

def verify_password(password: str, stored: str) -> bool:
    if stored.startswith("pbkdf2$"):
        _, salt, digest = stored.split("$")
        calc = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode(), 200_000).hex()
        return hmac.compare_digest(calc, digest)
    return hmac.compare_digest(legacy_hash(password), stored)

DEFAULT_ADMIN_PASSWORD = "AnaBeauty@2026"

def init_db():
    conn = get_db()
    cursor = conn.cursor()

    # Tabela de Usuários
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        phone TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'client', -- 'supervisor' ou 'client'
        created_at TEXT NOT NULL
    )
    """)

    # Tabela de Sessões
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """)

    # Tabela de Serviços
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS services (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        price REAL NOT NULL,
        duration_minutes INTEGER NOT NULL
    )
    """)

    # Tabela de Horários: por padrão NENHUM horário fica disponível sem autorização do supervisor.
    # is_active = 1 -> Autorizado pelo Supervisor (disponível para clientes)
    # is_active = 0 -> Indisponível / Bloqueado pelo Supervisor
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS schedules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL, -- YYYY-MM-DD
        time TEXT NOT NULL, -- HH:MM
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(date, time)
    )
    """)

    # Tabela de Agendamentos
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS appointments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        client_id INTEGER NOT NULL,
        service_id INTEGER NOT NULL,
        schedule_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        observation TEXT,
        status TEXT NOT NULL DEFAULT 'pendente', -- 'pendente', 'confirmado', 'concluido', 'cancelado'
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(client_id) REFERENCES users(id),
        FOREIGN KEY(service_id) REFERENCES services(id),
        FOREIGN KEY(schedule_id) REFERENCES schedules(id)
    )
    """)

    # Dados Iniciais (Seed)
    # 1. Usuário Supervisor: criado com a senha padrão; a troca é feita dentro do site (Minha Conta)
    cursor.execute("SELECT id FROM users WHERE username = 'admin'")
    if not cursor.fetchone():
        cursor.execute("""
        INSERT INTO users (username, name, phone, password_hash, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """, ("admin", "Ana Carolina (Designer & Supervisora)", "", hash_password(DEFAULT_ADMIN_PASSWORD), "supervisor", datetime.now().isoformat()))
    # 2. Conta de demonstração antiga: desativada se ainda usa a senha padrão
    cursor.execute("SELECT id, password_hash FROM users WHERE username = 'cliente'")
    demo = cursor.fetchone()
    if demo and verify_password("123456", demo["password_hash"]):
        cursor.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(secrets.token_urlsafe(24)), demo["id"]))
        cursor.execute("DELETE FROM sessions WHERE user_id = ?", (demo["id"],))
    # 3. Serviços Padrão
    cursor.execute("SELECT COUNT(*) as count FROM services")
    if cursor.fetchone()["count"] == 0:
        default_services = [
            ("Design Personalizado", "Mapeamento facial com paquímetro e alinhamento geométrico perfeito para o seu rosto.", 45.00, 35),
            ("Design com Henna", "Design sob medida + aplicação de henna com tonalidade e degradê natural para preenchimento de falhas.", 65.00, 50),
            ("Brow Lamination", "Técnica de alinhamento dos fios naturais para um efeito volumoso, alinhado e moderno com nutrição profunda.", 110.00, 60),
            ("Design + Coloração em Gel", "Pigmentação especial em gel com longa fixação nos fios e acabamento leve e sofisticado.", 75.00, 45),
            ("Micropigmentação Shadow / Nanoblading", "Técnica semi-permanente hiper-realista com nano agulhas para sobrancelhas impecáveis até 1 ano.", 380.00, 120),
            ("Spa e Nutrição de Sobrancelhas", "Argiloterapia, esfoliação suave, hidratação com óleos nobres e massagem relaxante nos folículos.", 55.00, 40),
        ]
        cursor.executemany("""
        INSERT INTO services (name, description, price, duration_minutes)
        VALUES (?, ?, ?, ?)
        """, default_services)

    # REGRA: Nenhum horário é gerado automaticamente.
    # Por padrão, TODOS os horários de qualquer dia são INDISPONÍVEIS.
    # O cliente só pode agendar os horários que o supervisor autorizar explicitamente!

    conn.commit()
    conn.close()

init_db()

# Dependência de Autenticação
def get_current_user(authorization: Optional[str] = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Não autorizado. Faça login primeiro.")
    token = authorization.split(" ")[1]
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT u.id, u.username, u.name, u.phone, u.role
    FROM sessions s
    JOIN users u ON s.user_id = u.id
    WHERE s.token = ? AND s.created_at >= ?
    """, (token, (datetime.now() - timedelta(days=SESSION_DAYS)).isoformat()))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=401, detail="Sessão expirada ou inválida.")
    return dict(row)

def require_supervisor(user: dict = Depends(get_current_user)):
    if user["role"] != "supervisor":
        raise HTTPException(status_code=403, detail="Acesso exclusivo para supervisores.")
    return user

# Schemas Pydantic
class RegisterRequest(BaseModel):
    username: str
    name: str
    phone: str
    password: str

class LoginRequest(BaseModel):
    username: str
    password: str

class CreateScheduleRequest(BaseModel):
    date: str # YYYY-MM-DD
    times: List[str] # ["09:00", "10:00", ...]

class BulkScheduleGenerateRequest(BaseModel):
    start_date: str
    end_date: str
    times: List[str]

class DatesScheduleRequest(BaseModel):
    dates: List[str]
    times: List[str]

class ServiceRequest(BaseModel):
    name: str
    description: Optional[str] = None
    price: float
    duration_minutes: int

class ProfileUpdateRequest(BaseModel):
    name: str
    phone: Optional[str] = None
    username: Optional[str] = None

class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str

class DayActionRequest(BaseModel):
    date: str

class AppointmentCreateRequest(BaseModel):
    service_id: int
    schedule_id: int
    observation: Optional[str] = Field(None, max_length=200)

class StatusUpdateRequest(BaseModel):
    status: str # 'confirmado', 'cancelado', 'concluido', 'pendente'

# Rotas de Autenticação
@app.post("/api/auth/register")
def register(data: RegisterRequest):
    username = data.username.strip().lower()
    name = data.name.strip()
    phone = data.phone.strip()
    password = data.password.strip()

    if not username or not password or not name:
        raise HTTPException(status_code=400, detail="Preencha todos os campos obrigatórios.")
    if len(password) < 4:
        raise HTTPException(status_code=400, detail="A senha deve ter pelo menos 4 caracteres.")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM users WHERE username = ?", (username,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Este nome de usuário ou e-mail já está cadastrado.")

    pw_hash = hash_password(password)
    now_iso = datetime.now().isoformat()
    cursor.execute("""
    INSERT INTO users (username, name, phone, password_hash, role, created_at)
    VALUES (?, ?, ?, ?, 'client', ?)
    """, (username, name, phone, pw_hash, now_iso))
    user_id = cursor.lastrowid

    token = secrets.token_hex(24)
    cursor.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, user_id, now_iso))
    conn.commit()
    conn.close()

    return {
        "token": token,
        "user": {
            "id": user_id,
            "username": username,
            "name": name,
            "phone": phone,
            "role": "client"
        }
    }

@app.post("/api/auth/login")
def login(data: LoginRequest):
    username = data.username.strip().lower()
    password = data.password.strip()

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, username, name, phone, password_hash, role
    FROM users WHERE username = ?
    """, (username,))
    user = cursor.fetchone()

    if not user or not verify_password(password, user["password_hash"]):
        conn.close()
        raise HTTPException(status_code=401, detail="Usuário ou senha incorretos.")

    token = secrets.token_hex(24)
    cursor.execute("INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)", (token, user["id"], datetime.now().isoformat()))
    conn.commit()
    conn.close()

    return {
        "token": token,
        "user": {
            "id": user["id"],
            "username": user["username"],
            "name": user["name"],
            "phone": user["phone"],
            "role": user["role"]
        }
    }

@app.get("/api/auth/me")
def me(user: dict = Depends(get_current_user)):
    return {"user": user}

def apply_profile_update(user_id: int, data: ProfileUpdateRequest, allow_username: bool = True):
    name = data.name.strip()
    if len(name) < 2:
        raise HTTPException(status_code=400, detail="Informe um nome válido.")
    conn = get_db()
    row = conn.execute("SELECT id, username, phone, role FROM users WHERE id = ?", (user_id,)).fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Usuário não encontrado.")
    phone = data.phone.strip() if data.phone is not None else row["phone"]
    username = row["username"]
    if data.username is not None and allow_username and row["username"] != "admin":
        username = data.username.strip().lower()
        if len(username) < 3:
            conn.close()
            raise HTTPException(status_code=400, detail="Informe um e-mail/usuário válido.")
        if username != row["username"] and conn.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone():
            conn.close()
            raise HTTPException(status_code=400, detail="Este e-mail/usuário já está em uso.")
    conn.execute("UPDATE users SET name = ?, phone = ?, username = ? WHERE id = ?", (name, phone, username, user_id))
    conn.commit()
    conn.close()
    return {"id": user_id, "username": username, "name": name, "phone": phone, "role": row["role"]}

@app.put("/api/auth/profile")
def update_profile(data: ProfileUpdateRequest, user: dict = Depends(get_current_user)):
    updated = apply_profile_update(user["id"], data)
    return {"message": "Dados atualizados com sucesso.", "user": updated}

@app.put("/api/supervisor/clients/{client_id}")
def update_client(client_id: int, data: ProfileUpdateRequest, supervisor: dict = Depends(require_supervisor)):
    conn = get_db()
    row = conn.execute("SELECT role FROM users WHERE id = ?", (client_id,)).fetchone()
    conn.close()
    if not row or row["role"] != "client":
        raise HTTPException(status_code=404, detail="Cliente não encontrada.")
    apply_profile_update(client_id, data)
    return {"message": "Dados da cliente atualizados com sucesso."}
@app.post("/api/auth/change-password")
def change_password(data: PasswordChangeRequest, user: dict = Depends(get_current_user), authorization: Optional[str] = Header(None)):
    if len(data.new_password) < 4:
        raise HTTPException(status_code=400, detail="A nova senha deve ter pelo menos 4 caracteres.")
    conn = get_db()
    row = conn.execute("SELECT password_hash FROM users WHERE id = ?", (user["id"],)).fetchone()
    if not row or not verify_password(data.current_password.strip(), row["password_hash"]):
        conn.close()
        raise HTTPException(status_code=400, detail="Senha atual incorreta.")
    token = authorization.split(" ")[1]
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (hash_password(data.new_password.strip()), user["id"]))
    conn.execute("DELETE FROM sessions WHERE user_id = ? AND token != ?", (user["id"], token))
    conn.commit()
    conn.close()
    return {"message": "Senha alterada com sucesso."}

@app.get("/api/supervisor/clients")
def list_clients(supervisor: dict = Depends(require_supervisor)):
    conn = get_db()
    rows = conn.execute("SELECT id, username, name, phone FROM users WHERE role = 'client' ORDER BY name COLLATE NOCASE").fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/supervisor/clients/{client_id}/reset-password")
def reset_client_password(client_id: int, supervisor: dict = Depends(require_supervisor)):
    conn = get_db()
    cur = conn.execute("UPDATE users SET password_hash = ? WHERE id = ? AND role = 'client'", (hash_password("1234"), client_id))
    if not cur.rowcount:
        conn.close()
        raise HTTPException(status_code=404, detail="Cliente não encontrado.")
    conn.execute("DELETE FROM sessions WHERE user_id = ?", (client_id,))
    conn.commit()
    conn.close()
    return {"message": "Senha redefinida para 1234. A cliente pode alterá-la depois em 'Minha Conta'."}

@app.post("/api/auth/logout")
def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]
        conn = get_db()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM sessions WHERE token = ?", (token,))
        conn.commit()
        conn.close()
    return {"message": "Desconectado com sucesso."}

@app.get("/api/contact")
def contact_info():
    """Telefone/WhatsApp público da supervisora (usuário admin)"""
    conn = get_db()
    row = conn.execute("SELECT phone FROM users WHERE username = 'admin'").fetchone()
    conn.close()
    return {"phone": row["phone"] if row and row["phone"] else ""}

# Rotas de Serviços
@app.get("/api/services")
def list_services():
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, description, price, duration_minutes FROM services ORDER BY id")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def _validate_service(data: ServiceRequest):
    if not data.name.strip():
        raise HTTPException(status_code=400, detail="Nome do serviço é obrigatório.")
    if data.price < 0 or data.duration_minutes <= 0:
        raise HTTPException(status_code=400, detail="Valor e duração devem ser válidos.")

@app.post("/api/supervisor/services")
def create_service(data: ServiceRequest, supervisor: dict = Depends(require_supervisor)):
    _validate_service(data)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "INSERT INTO services (name, description, price, duration_minutes) VALUES (?, ?, ?, ?)",
        (data.name.strip(), (data.description or "").strip(), data.price, data.duration_minutes))
    conn.commit()
    conn.close()
    return {"message": "Serviço criado com sucesso."}

@app.put("/api/supervisor/services/{service_id}")
def update_service(service_id: int, data: ServiceRequest, supervisor: dict = Depends(require_supervisor)):
    _validate_service(data)
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE services SET name = ?, description = ?, price = ?, duration_minutes = ? WHERE id = ?",
        (data.name.strip(), (data.description or "").strip(), data.price, data.duration_minutes, service_id))
    updated = cursor.rowcount
    conn.commit()
    conn.close()
    if not updated:
        raise HTTPException(status_code=404, detail="Serviço não encontrado.")
    return {"message": "Serviço atualizado com sucesso."}

@app.delete("/api/supervisor/services/{service_id}")
def delete_service(service_id: int, supervisor: dict = Depends(require_supervisor)):
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) as c FROM appointments WHERE service_id = ?", (service_id,))
    if cursor.fetchone()["c"] > 0:
        conn.close()
        raise HTTPException(status_code=400, detail="Este serviço possui agendamentos e não pode ser excluído. Edite-o em vez disso.")
    cursor.execute("DELETE FROM services WHERE id = ?", (service_id,))
    conn.commit()
    conn.close()
    return {"message": "Serviço excluído com sucesso."}

# Rotas de Horários Disponíveis (Para o Cliente)
@app.get("/api/schedules/available")
def get_available_schedules(date: str = Query(...)):
    """
    Retorna SOMENTE os horários explicitamente AUTORIZADOS pelo supervisor (is_active = 1)
    e que ainda NÃO estejam reservados por agendamento pendente ou confirmado.
    Se o supervisor não autorizou horários para este dia, nenhum horário estará disponível.
    """
    conn = get_db()
    cursor = conn.cursor()
    
    query = """
    SELECT s.id, s.date, s.time
    FROM schedules s
    WHERE s.date = ? AND s.is_active = 1
      AND s.id NOT IN (
          SELECT schedule_id FROM appointments 
          WHERE date = ? AND status IN ('pendente', 'confirmado')
      )
    ORDER BY s.time ASC
    """
    cursor.execute(query, (date, date))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

# Rotas do Supervisor - Gerenciamento e Autorização de Horários
@app.get("/api/supervisor/schedules")
def get_supervisor_schedules(date: Optional[str] = None, supervisor: dict = Depends(require_supervisor)):
    """Retorna a grade de horários com status (autorizado/indisponível/reservado)"""
    conn = get_db()
    cursor = conn.cursor()
    
    if date:
        query = """
        SELECT s.id, s.date, s.time, s.is_active,
               a.id as appointment_id, a.status as appointment_status,
               u.name as client_name, u.phone as client_phone,
               srv.name as service_name
        FROM schedules s
        LEFT JOIN appointments a ON s.id = a.schedule_id AND a.status IN ('pendente', 'confirmado')
        LEFT JOIN users u ON a.client_id = u.id
        LEFT JOIN services srv ON a.service_id = srv.id
        WHERE s.date = ?
        ORDER BY s.time ASC
        """
        cursor.execute(query, (date,))
    else:
        query = """
        SELECT s.id, s.date, s.time, s.is_active,
               a.id as appointment_id, a.status as appointment_status,
               u.name as client_name, u.phone as client_phone,
               srv.name as service_name
        FROM schedules s
        LEFT JOIN appointments a ON s.id = a.schedule_id AND a.status IN ('pendente', 'confirmado')
        LEFT JOIN users u ON a.client_id = u.id
        LEFT JOIN services srv ON a.service_id = srv.id
        ORDER BY s.date DESC, s.time ASC
        LIMIT 200
        """
        cursor.execute(query)

    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/supervisor/schedules")
def authorize_schedules(data: CreateScheduleRequest, supervisor: dict = Depends(require_supervisor)):
    """Supervisor autoriza e disponibiliza horários para os clientes em determinada data"""
    if not data.date or not data.times:
        raise HTTPException(status_code=400, detail="Data e horários são obrigatórios.")
    
    conn = get_db()
    cursor = conn.cursor()
    now_iso = datetime.now().isoformat()
    count = 0
    for t in data.times:
        t_clean = t.strip()
        if t_clean:
            cursor.execute("""
            INSERT INTO schedules (date, time, is_active, created_at)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(date, time) DO UPDATE SET is_active = 1
            """, (data.date, t_clean, now_iso))
            count += 1
    conn.commit()
    conn.close()
    return {"message": f"{count} horário(s) autorizados com sucesso para clientes na data {data.date}."}

@app.post("/api/supervisor/schedules/bulk")
def bulk_authorize_schedules(data: BulkScheduleGenerateRequest, supervisor: dict = Depends(require_supervisor)):
    """Supervisor autoriza horários para um período selecionado"""
    try:
        start = datetime.strptime(data.start_date, "%Y-%m-%d").date()
        end = datetime.strptime(data.end_date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de data inválido. Use AAAA-MM-DD.")
    
    if start > end:
        raise HTTPException(status_code=400, detail="Data inicial não pode ser maior que data final.")
    
    conn = get_db()
    cursor = conn.cursor()
    now_iso = datetime.now().isoformat()
    count = 0

    curr = start
    while curr <= end:
        for t in data.times:
            cursor.execute("""
            INSERT INTO schedules (date, time, is_active, created_at)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(date, time) DO UPDATE SET is_active = 1
            """, (curr.isoformat(), t.strip(), now_iso))
            count += 1
        curr += timedelta(days=1)

    conn.commit()
    conn.close()
    return {"message": f"{count} horários autorizados no período com sucesso."}

@app.post("/api/supervisor/schedules/dates")
def authorize_schedule_dates(data: DatesScheduleRequest, supervisor: dict = Depends(require_supervisor)):
    """Supervisor autoriza horários em datas específicas marcadas no calendário"""
    times = [t.strip() for t in data.times if t.strip()]
    if not data.dates or not times:
        raise HTTPException(status_code=400, detail="Datas e horários são obrigatórios.")
    try:
        dates = sorted({datetime.strptime(d, "%Y-%m-%d").date().isoformat() for d in data.dates})
    except ValueError:
        raise HTTPException(status_code=400, detail="Formato de data inválido. Use AAAA-MM-DD.")

    conn = get_db()
    cursor = conn.cursor()
    now_iso = datetime.now().isoformat()
    for d in dates:
        for t in times:
            cursor.execute("""
            INSERT INTO schedules (date, time, is_active, created_at)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(date, time) DO UPDATE SET is_active = 1
            """, (d, t, now_iso))
    conn.commit()
    conn.close()
    return {"message": f"{len(dates) * len(times)} horário(s) autorizados em {len(dates)} dia(s)."}

@app.patch("/api/supervisor/schedules/{schedule_id}/toggle")
def toggle_schedule_authorization(schedule_id: int, supervisor: dict = Depends(require_supervisor)):
    """
    Alterna o status do horário entre:
    - 1: Autorizado / Disponível para clientes
    - 0: Indisponível / Bloqueado
    """
    conn = get_db()
    cursor = conn.cursor()
    
    # Verifica agendamento ativo
    cursor.execute("""
    SELECT COUNT(*) as active_count FROM appointments 
    WHERE schedule_id = ? AND status IN ('pendente', 'confirmado')
    """, (schedule_id,))
    if cursor.fetchone()["active_count"] > 0:
        conn.close()
        raise HTTPException(status_code=400, detail="Não é possível alterar este horário pois ele já possui um agendamento ativo de cliente.")

    cursor.execute("SELECT is_active FROM schedules WHERE id = ?", (schedule_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="Horário não encontrado.")

    new_status = 0 if row["is_active"] == 1 else 1
    cursor.execute("UPDATE schedules SET is_active = ? WHERE id = ?", (new_status, schedule_id))
    conn.commit()
    conn.close()

    status_str = "autorizado e disponível para clientes" if new_status == 1 else "marcado como indisponível/bloqueado"
    return {"message": f"Horário {status_str}.", "is_active": new_status}

@app.post("/api/supervisor/schedules/day/block-all")
def block_all_day_schedules(data: DayActionRequest, supervisor: dict = Depends(require_supervisor)):
    """Torna todos os horários livres de um determinado dia INDISPONÍVEIS para clientes"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("""
    UPDATE schedules 
    SET is_active = 0 
    WHERE date = ? 
      AND id NOT IN (
          SELECT schedule_id FROM appointments 
          WHERE date = ? AND status IN ('pendente', 'confirmado')
      )
    """, (data.date, data.date))
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"Todos os horários de {data.date} foram bloqueados e estão indisponíveis para clientes."}

@app.post("/api/supervisor/schedules/day/authorize-all")
def authorize_all_day_schedules(data: DayActionRequest, supervisor: dict = Depends(require_supervisor)):
    """Torna todos os horários cadastrados daquele dia AUTORIZADOS/DISPONÍVEIS para clientes"""
    conn = get_db()
    cursor = conn.cursor()
    
    cursor.execute("UPDATE schedules SET is_active = 1 WHERE date = ?", (data.date,))
    rows_affected = cursor.rowcount
    conn.commit()
    conn.close()
    return {"message": f"Todos os horários de {data.date} foram autorizados com sucesso para clientes."}

@app.delete("/api/supervisor/schedules/{schedule_id}")
def delete_schedule(schedule_id: int, supervisor: dict = Depends(require_supervisor)):
    """Remove um horário cadastrado caso não possua agendamento ativo"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT COUNT(*) as active_count FROM appointments 
    WHERE schedule_id = ? AND status IN ('pendente', 'confirmado')
    """, (schedule_id,))
    if cursor.fetchone()["active_count"] > 0:
        conn.close()
        raise HTTPException(status_code=400, detail="Não é possível excluir um horário que possui agendamento ativo.")

    cursor.execute("DELETE FROM schedules WHERE id = ?", (schedule_id,))
    conn.commit()
    conn.close()
    return {"message": "Horário removido com sucesso."}

# Rotas de Agendamentos (Clientes e Supervisor)
@app.post("/api/appointments")
def create_appointment(data: AppointmentCreateRequest, user: dict = Depends(get_current_user)):
    """Cliente realiza agendamento somente em horário autorizado e vago"""
    conn = get_db()
    cursor = conn.cursor()

    # Verifica se o horário existe e está ATIVO/AUTORIZADO pelo supervisor
    cursor.execute("SELECT id, date, time, is_active FROM schedules WHERE id = ?", (data.schedule_id,))
    sched = cursor.fetchone()
    if not sched or sched["is_active"] == 0:
        conn.close()
        raise HTTPException(status_code=400, detail="Este horário não está autorizado pela supervisora ou foi bloqueado.")

    # Verifica se já está agendado por outro cliente
    cursor.execute("""
    SELECT id FROM appointments 
    WHERE schedule_id = ? AND status IN ('pendente', 'confirmado')
    """, (data.schedule_id,))
    if cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Este horário já foi reservado por outra cliente. Por favor, escolha outro horário vago.")

    # Verifica serviço
    cursor.execute("SELECT id FROM services WHERE id = ?", (data.service_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=400, detail="Serviço não encontrado.")

    now_iso = datetime.now().isoformat()
    cursor.execute("""
    INSERT INTO appointments (client_id, service_id, schedule_id, date, time, observation, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'pendente', ?, ?)
    """, (user["id"], data.service_id, data.schedule_id, sched["date"], sched["time"], (data.observation or "").strip(), now_iso, now_iso))

    app_id = cursor.lastrowid
    conn.commit()
    conn.close()

    return {"message": "Agendamento realizado com sucesso! Aguarde a confirmação da supervisora.", "appointment_id": app_id}

@app.get("/api/appointments/my")
def get_my_appointments(user: dict = Depends(get_current_user)):
    """Cliente consulta todos os seus agendamentos"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT a.id, a.date, a.time, a.observation, a.status, a.created_at,
           s.name as service_name, s.price as service_price, s.duration_minutes
    FROM appointments a
    JOIN services s ON a.service_id = s.id
    WHERE a.client_id = ?
    ORDER BY a.date DESC, a.time DESC
    """, (user["id"],))
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.post("/api/appointments/{appointment_id}/cancel")
def cancel_my_appointment(appointment_id: int, user: dict = Depends(get_current_user)):
    """Cliente cancela seu próprio agendamento"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, client_id, status FROM appointments WHERE id = ?", (appointment_id,))
    app_record = cursor.fetchone()
    if not app_record:
        conn.close()
        raise HTTPException(status_code=404, detail="Agendamento não encontrado.")
    
    if app_record["client_id"] != user["id"] and user["role"] != "supervisor":
        conn.close()
        raise HTTPException(status_code=403, detail="Você não tem permissão para cancelar este agendamento.")

    if app_record["status"] in ["cancelado", "concluido"]:
        conn.close()
        raise HTTPException(status_code=400, detail="Este agendamento já foi finalizado ou cancelado.")

    now_iso = datetime.now().isoformat()
    cursor.execute("UPDATE appointments SET status = 'cancelado', updated_at = ? WHERE id = ?", (now_iso, appointment_id))
    conn.commit()
    conn.close()
    return {"message": "Agendamento cancelado com sucesso."}

# Rotas de Agendamentos do Supervisor
@app.get("/api/supervisor/appointments")
def list_all_appointments(
    status: Optional[str] = None,
    date: Optional[str] = None,
    supervisor: dict = Depends(require_supervisor)
):
    """Supervisor visualiza e filtra todos os agendamentos realizados"""
    conn = get_db()
    cursor = conn.cursor()

    conditions = []
    params = []

    if status and status != "todos":
        conditions.append("a.status = ?")
        params.append(status)
    if date:
        conditions.append("a.date = ?")
        params.append(date)

    where_clause = "WHERE " + " AND ".join(conditions) if conditions else ""

    query = f"""
    SELECT a.id, a.date, a.time, a.observation, a.status, a.created_at, a.updated_at,
           u.id as client_id, u.name as client_name, u.phone as client_phone, u.username as client_username,
           s.id as service_id, s.name as service_name, s.price as service_price, s.duration_minutes
    FROM appointments a
    JOIN users u ON a.client_id = u.id
    JOIN services s ON a.service_id = s.id
    {where_clause}
    ORDER BY a.date DESC, a.time DESC
    """
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

@app.patch("/api/supervisor/appointments/{appointment_id}/status")
def update_appointment_status(
    appointment_id: int,
    data: StatusUpdateRequest,
    supervisor: dict = Depends(require_supervisor)
):
    """Supervisor confirma, cancela ou conclui um agendamento"""
    allowed_statuses = ["pendente", "confirmado", "concluido", "cancelado"]
    if data.status not in allowed_statuses:
        raise HTTPException(status_code=400, detail=f"Status inválido. Escolha entre: {', '.join(allowed_statuses)}")

    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM appointments WHERE id = ?", (appointment_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="Agendamento não encontrado.")

    now_iso = datetime.now().isoformat()
    cursor.execute("UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?", (data.status, now_iso, appointment_id))
    conn.commit()
    conn.close()

    status_labels = {
        "confirmado": "confirmado com sucesso!",
        "cancelado": "cancelado.",
        "concluido": "marcado como concluído!",
        "pendente": "redefinido para pendente."
    }
    return {"message": f"Agendamento {status_labels.get(data.status, 'atualizado.')}", "status": data.status}

@app.middleware("http")
async def security_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "same-origin"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store"
    return response

# Rota estática e página principal
app.mount("/static", StaticFiles(directory=os.path.join(BASE_DIR, "static")), name="static")

@app.get("/")
def read_index():
    return FileResponse(os.path.join(BASE_DIR, "static", "index.html"))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8000")))
