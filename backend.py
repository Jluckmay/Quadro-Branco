from fastapi import FastAPI, WebSocket, Query
from starlette.websockets import WebSocketState
import threading
from core_client import start_connection, atualizar_estado
from supabase import create_client, Client
import datetime
from jose import jwt, JWTError
import json
import asyncio

SUPABASE_URL = "https://dayvyzxacovefbjgluaq.supabase.co"
SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRheXZ5enhhY292ZWZiamdsdWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk0MjE0MDAsImV4cCI6MjA2NDk5NzQwMH0.ofuj_A96OXS1eJ7b_F-f0-9AjJtWNX-sS8cavcdIqNY"
SUPABASE_JWT_SECRET = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRheXZ5enhhY292ZWZiamdsdWFxIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc0OTQyMTQwMCwiZXhwIjoyMDY0OTk3NDAwfQ.vusfUw2JcrTQ9WJ2b02YWwCw-NNjwmixZAjvMy9Prms"

supabase_client: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
app = FastAPI()

quadro_dados = {}
locks = {}
frontends = set()
core_ws = None

@app.websocket("/ws/frontend")
async def websocket_frontend(websocket: WebSocket, token: str = Query(None)):
    await websocket.accept()

    try:
        payload = jwt.get_unverified_claims(token)
        usuario_id = payload.get("sub", "Desconhecido")
        usuario_email = payload.get("email", "sem_email")
        print(f"🔌 Frontend conectado (sem verificação): {usuario_email}")
    except JWTError as e:
        print("❌ Erro ao extrair payload do token:", e)
        await websocket.close()
        return

    try:
        response = supabase_client.table("quadro_estado") \
            .select("estado") \
            .eq("sessao_id", "sessao123") \
            .order("atualizado_em", desc=True) \
            .limit(1) \
            .execute()

        if not response.data:
            supabase_client.table("quadro_estado").insert({
                "sessao_id": "sessao123",
                "estado": [],
                "atualizado_em": datetime.datetime.utcnow().isoformat()
            }).execute()
            print("🆕 Estado inicial criado em 'quadro_estado'")
            estado = []
        else:
            estado = response.data[0]["estado"]

        objetos = []
        if estado:
            objetos_response = supabase_client.table("objetos") \
                .select("*") \
                .in_("id", estado) \
                .execute()
            objetos = objetos_response.data if objetos_response and hasattr(objetos_response, "data") else []

        await websocket.send_json({
            "tipo": "estado_inicial",
            "objetos": objetos
        })
        print(f"📤 Estado inicial enviado para {websocket.client.host}")

    except Exception as e:
        print("❌ Erro ao buscar estado inicial do quadro:", e)

    frontends.add(websocket)
    print(f"🔌 Frontend conectado: {usuario_email}")

    try:
        while True:
            if websocket.application_state != WebSocketState.CONNECTED:
                break

            data = await websocket.receive_json()
            tipo = data.get("tipo")
            acao = data.get("acao")
            conteudo = data.get("conteudo")

            if tipo == "lock":
                index = conteudo.get("index")
                if acao == "adquirir":
                    if locks.get(index) in [None, usuario_id]:
                        locks[index] = usuario_id
                        print(f"🔒 Lock adquirido por {usuario_email} no objeto {index}")

                        for cliente in frontends:
                            if cliente.application_state == WebSocketState.CONNECTED:
                                await cliente.send_json({
                                    "tipo": "lock",
                                    "acao": "adquirido",
                                    "conteudo": {"index": index, "usuario_id": usuario_id}
                                })

                        async def liberar_lock_automaticamente(index_local, dono_lock, ws_ref):
                            await asyncio.sleep(2)
                            if locks.get(index_local) == dono_lock:
                                del locks[index_local]
                                print(f"⏲️ Lock expirado automaticamente no objeto {index_local} (usuário {dono_lock})")
                                for cliente in frontends:
                                    if cliente.application_state == WebSocketState.CONNECTED:
                                        await cliente.send_json({
                                            "tipo": "lock",
                                            "acao": "liberado",
                                            "conteudo": {"index": index_local}
                                        })

                        asyncio.create_task(liberar_lock_automaticamente(index, usuario_id, websocket))

                    else:
                        print(f"❌ Lock negado para {usuario_email} no objeto {index} (já está com {locks.get(index)})")
                        for cliente in frontends:
                            if cliente.application_state == WebSocketState.CONNECTED:
                                await cliente.send_json({
                                    "tipo": "lock",
                                    "acao": "liberado",
                                    "conteudo": {"index": index}
                                })

                    continue
                elif acao == "liberar":
                    if locks.get(index) == usuario_id:
                        del locks[index]
                        print(f"🔓 Lock liberado por {usuario_email} no objeto {index}")
                        await websocket.send_json({
                            "tipo": "lock",
                            "acao": "liberado",
                            "conteudo": {"index": index}
                        })
                    continue

            quadro_dados[usuario_id] = conteudo
            print(f"📥 {usuario_email} enviou: {conteudo}")

            try:
                # 🛠 Persistência da movimentação
                if tipo == "desenho" and acao == "mover_objeto":
                    objeto_id = conteudo.get("id") or conteudo.get("index")
                    novo_conteudo = conteudo.get("objeto")

                    if objeto_id is not None and novo_conteudo:
                        supabase_client.table("objetos").update({
                            "conteudo": json.dumps(novo_conteudo),
                            "acao": "mover_objeto"
                        }).eq("id", objeto_id).execute()

                        print(f"✏️ Objeto {objeto_id} movido e atualizado no Supabase.")

                        for cliente in frontends:
                            if cliente.application_state == WebSocketState.CONNECTED and cliente != websocket:
                                await cliente.send_json({
                                    "tipo": tipo,
                                    "acao": acao,
                                    "conteudo": conteudo
                                })
                    continue  # pular o insert

                # Inserção padrão (novo objeto, resetar etc.)
                insert_result = supabase_client.table("objetos").insert({
                    "usuario_id": usuario_id,
                    "sessao_id": "sessao123",
                    "tipo": tipo,
                    "acao": acao,
                    "conteudo": json.dumps(conteudo)
                }).execute()

                if insert_result.data and isinstance(insert_result.data, list):
                    objeto_id = insert_result.data[0]["id"]
                    print(f"✅ Objeto salvo com ID: {objeto_id}")

                    estado_resp = supabase_client.table("quadro_estado") \
                        .select("estado") \
                        .eq("sessao_id", "sessao123") \
                        .limit(1) \
                        .execute()

                    estado_atual = estado_resp.data[0]["estado"] if estado_resp.data else []

                    if tipo == "resetar":
                        estado_atual = []
                    elif tipo == "desenho" and acao == "remover_objeto":
                        objeto_id_removido = conteudo.get("id")
                        if objeto_id_removido in estado_atual:
                            estado_atual.remove(objeto_id_removido)
                    else:
                        estado_atual.append(objeto_id)

                    supabase_client.table("quadro_estado").update({
                        "estado": estado_atual,
                        "atualizado_em": datetime.datetime.utcnow().isoformat()
                    }).eq("sessao_id", "sessao123").execute()
                    print("🆙 Estado atualizado com novo ID.")

                    for cliente in frontends:
                        if cliente.application_state == WebSocketState.CONNECTED and cliente != websocket:
                            await cliente.send_json({
                                "tipo": tipo,
                                "acao": acao,
                                "conteudo": conteudo
                            })

                else:
                    print("⚠️ Inserção não retornou ID.")

            except Exception as e:
                print("❌ Erro ao salvar ou atualizar estado no Supabase:", e)

    except Exception as e:
        print(f"⚠️ {usuario_email} desconectado.")
        print("❌ Erro:", e)
    finally:
        frontends.remove(websocket)
        for index, dono in list(locks.items()):
            if dono == usuario_id:
                del locks[index]
                print(f"🔓 Lock liberado automaticamente do objeto {index} por desconexão")


threading.Thread(
    target=lambda: start_connection(lambda: len(frontends)),
    daemon=True
).start()
