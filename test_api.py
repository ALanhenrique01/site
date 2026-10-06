import os, tempfile
os.environ['DB_FILE'] = os.path.join(tempfile.mkdtemp(), 'test.db')
from fastapi.testclient import TestClient
from server import app

client = TestClient(app)

def run_tests():
    print("--- TESTE 1: Login do Supervisor ---")
    res = client.post("/api/auth/login", json={"username": "admin", "password": "AnaBeauty@2026"})
    assert res.status_code == 200, res.text
    sup_token = res.json()["token"]
    sup_headers = {"Authorization": f"Bearer {sup_token}"}
    print("OK! Supervisor autenticado.")

    print("\n--- TESTE 2: Garantir que SEM AUTORIZAÇÃO, a data está INDISPONÍVEL para clientes ---")
    test_date = "2026-11-20"
    res = client.get(f"/api/schedules/available?date={test_date}")
    assert res.status_code == 200
    slots = res.json()
    assert len(slots) == 0, f"Esperado 0 horários disponíveis sem autorização, obteve {len(slots)}"
    print("OK! Data não-autorizada tem 0 horários disponíveis (indisponível por padrão).")

    print("\n--- TESTE 3: Supervisor AUTORIZA horários para a data ---")
    res = client.post("/api/supervisor/schedules", headers=sup_headers, json={
        "date": test_date,
        "times": ["09:00", "11:00", "15:00"]
    })
    assert res.status_code == 200, res.text
    print("OK! Supervisor autorizou 3 horários.")

    print("\n--- TESTE 4: Cliente agora visualiza APENAS os horários que o supervisor autorizou ---")
    res = client.get(f"/api/schedules/available?date={test_date}")
    assert res.status_code == 200
    slots = res.json()
    assert len(slots) == 3
    times = [s["time"] for s in slots]
    assert "09:00" in times and "11:00" in times and "15:00" in times
    print(f"OK! Cliente vê apenas os horários autorizados: {times}")

    print("\n--- TESTE 5: Supervisor BLOQUEIA / TORNA INDISPONÍVEL um horário específico (11:00) ---")
    slot_11 = next(s for s in slots if s["time"] == "11:00")
    res = client.patch(f"/api/supervisor/schedules/{slot_11['id']}/toggle", headers=sup_headers)
    assert res.status_code == 200
    assert res.json()["is_active"] == 0
    print("OK! Horário 11:00 marcado como indisponível/bloqueado pelo supervisor.")

    print("\n--- TESTE 6: Cliente NÃO deve mais ver o horário 11:00 ---")
    res = client.get(f"/api/schedules/available?date={test_date}")
    assert res.status_code == 200
    active_times = [s["time"] for s in res.json()]
    assert "11:00" not in active_times
    assert "09:00" in active_times and "15:00" in active_times
    print(f"OK! Horário bloqueado sumiu da visualização do cliente: {active_times}")

    print("\n--- TESTE 7: Cliente tenta agendar em horário autorizado (09:00) com observação ---")
    # Login cliente
    res_c = client.post("/api/auth/register", json={"username": "cliente@teste.com", "name": "Cliente Teste", "phone": "11999999999", "password": "123456"})
    client_token = res_c.json()["token"]
    client_headers = {"Authorization": f"Bearer {client_token}"}
    
    # Serviços
    services = client.get("/api/services").json()
    slot_09 = next(s for s in slots if s["time"] == "09:00")

    obs = "Minha pele é sensível. Prefiro design com pinça e sem cera."
    res_app = client.post("/api/appointments", headers=client_headers, json={
        "service_id": services[0]["id"],
        "schedule_id": slot_09["id"],
        "observation": obs
    })
    assert res_app.status_code == 200, res_app.text
    app_id = res_app.json()["appointment_id"]
    print("OK! Agendamento criado pelo cliente com observação.")

    print("\n--- TESTE 8: Horário 09:00 não fica mais disponível para outros clientes ---")
    res = client.get(f"/api/schedules/available?date={test_date}")
    current_slots = [s["time"] for s in res.json()]
    assert "09:00" not in current_slots
    assert "15:00" in current_slots
    print("OK! Horário reservado não aparece mais como disponível.")

    print("\n--- TESTE 9: Supervisor visualiza o agendamento, lê a observação e confirma ---")
    res_sup = client.get("/api/supervisor/appointments", headers=sup_headers)
    assert res_sup.status_code == 200
    item = next(a for a in res_sup.json() if a["id"] == app_id)
    assert item["observation"] == obs
    assert item["status"] == "pendente"
    print(f"OK! Observação do cliente confirmada no painel da supervisora: '{item['observation']}'")

    res_conf = client.patch(f"/api/supervisor/appointments/{app_id}/status", headers=sup_headers, json={
        "status": "confirmado"
    })
    assert res_conf.status_code == 200
    print("OK! Supervisor confirmou o agendamento com sucesso.")

    print("\n--- TESTE 10: Supervisor bloqueia TODOS os horários restantes do dia ---")
    res_block = client.post("/api/supervisor/schedules/day/block-all", headers=sup_headers, json={"date": test_date})
    assert res_block.status_code == 200

    # Cliente consulta novamente: deve ter 0 horários livres
    res = client.get(f"/api/schedules/available?date={test_date}")
    assert len(res.json()) == 0
    print("OK! Todos os horários do dia agora estão indisponíveis para clientes.")

    print("\n--- TESTE 11: Perfil, troca e reset de senha ---")
    ch = {"Authorization": f"Bearer {client_token}"}
    r = client.put("/api/auth/profile", headers=ch, json={"name": "Novo Nome"})
    assert r.status_code == 200 and r.json()["user"]["name"] == "Novo Nome"
    r = client.post("/api/auth/change-password", headers=ch, json={"current_password": "errada", "new_password": "abcd"})
    assert r.status_code == 400
    r = client.post("/api/auth/change-password", headers=ch, json={"current_password": "123456", "new_password": "abcd"})
    assert r.status_code == 200
    r = client.post("/api/auth/login", json={"username": "cliente@teste.com", "password": "abcd"})
    assert r.status_code == 200
    cid = r.json()["user"]["id"]
    assert client.post(f"/api/supervisor/clients/{cid}/reset-password", headers=ch).status_code == 403
    assert client.post(f"/api/supervisor/clients/{cid}/reset-password", headers=sup_headers).status_code == 200
    assert client.post("/api/auth/login", json={"username": "cliente@teste.com", "password": "1234"}).status_code == 200
    ch = {"Authorization": "Bearer " + client.post("/api/auth/login", json={"username": "cliente@teste.com", "password": "1234"}).json()["token"]}
    r = client.put("/api/auth/profile", headers=ch, json={"name": "Novo Nome", "phone": "11888887777", "username": "novo@teste.com"})
    assert r.status_code == 200 and r.json()["user"]["username"] == "novo@teste.com"
    assert client.post("/api/auth/login", json={"username": "novo@teste.com", "password": "1234"}).status_code == 200
    r = client.put("/api/auth/profile", headers=ch, json={"name": "Novo Nome", "username": "admin"})
    assert r.status_code == 400
    r = client.put(f"/api/supervisor/clients/{cid}", headers=sup_headers, json={"name": "Editada", "phone": "11777776666", "username": "editada@teste.com"})
    assert r.status_code == 200
    assert client.put(f"/api/supervisor/clients/{cid}", headers=ch, json={"name": "x"}).status_code == 403
    assert any(c["username"] == "editada@teste.com" and c["phone"] == "11777776666" for c in client.get("/api/supervisor/clients", headers=sup_headers).json())
    print("OK! Perfil e senha funcionando.")

    print("\n=== TODOS OS TESTES DE AUTORIZAÇÃO E INDISPONIBILIDADE PASSARAM COM 100% DE SUCESSO! ===")

if __name__ == "__main__":
    run_tests()

