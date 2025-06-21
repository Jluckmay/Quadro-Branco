import streamlit as st
from streamlit_drawable_canvas import st_canvas
import asyncio
import websockets
import threading
import json

# URL do backend
BACKEND_URL = "ws://127.0.0.1:8000/ws/frontend"

# Estado global
if "mensagens" not in st.session_state:
    st.session_state["mensagens"] = []

if "last_canvas" not in st.session_state:
    st.session_state["last_canvas"] = None

# Sidebar para nome do usuário
st.sidebar.title("👤 Identificação")
usuario = st.sidebar.text_input("Seu nome ou apelido:", value="Anônimo")

# Função para enviar dados via WebSocket
async def enviar_para_backend(mensagem):
    try:
        async with websockets.connect(BACKEND_URL) as ws:
            await ws.send(json.dumps(mensagem))
    except Exception as e:
        st.warning(f"Erro ao enviar: {e}")

# Função para escutar respostas do backend
async def escutar_backend():
    try:
        async with websockets.connect(BACKEND_URL) as ws:
            while True:
                try:
                    resposta = await ws.recv()
                    msg = json.loads(resposta)
                    st.session_state["mensagens"].append(f"🔁 Backend: {msg}")
                    st.experimental_rerun()
                except websockets.exceptions.ConnectionClosed:
                    break
    except Exception as e:
        st.warning(f"Erro ao escutar backend: {e}")

# Thread para escutar o backend
def iniciar_listener():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(escutar_backend())

# Inicia apenas uma vez
if "listener_iniciado" not in st.session_state:
    thread = threading.Thread(target=iniciar_listener, daemon=True)
    thread.start()
    st.session_state["listener_iniciado"] = True

# Interface gráfica
st.title("🧠 Quadro Branco Virtual - G1")

# Área de desenho (lousa branca)
canvas_result = st_canvas(
    fill_color="rgba(255, 255, 255, 0)",
    stroke_width=3,
    stroke_color="#000000",
    background_color="#FFFFFF",
    width=1000,
    height=500,
    drawing_mode="freedraw",
    key="canvas",
    update_streamlit=True,
)

# Envia alteração automática no desenho com identificação da ação
if canvas_result.json_data is not None:
    current_data = canvas_result.json_data
    current_objects = current_data.get("objects", [])

    last_data = st.session_state["last_canvas"]
    last_objects = last_data.get("objects", []) if last_data else []

    # Verifica mudanças
    if current_data != last_data:
        st.session_state["last_canvas"] = current_data

        if not current_objects:
            acao = "apagar"
            st.session_state["mensagens"].append(f"🗑 Desenho apagado por {usuario}")
        elif len(current_objects) < len(last_objects):
            acao = "desfazer"
            st.session_state["mensagens"].append(f"↩️ Desfazer desenho por {usuario}")
        elif len(current_objects) > len(last_objects):
            acao = "refazer_ou_novo"
            st.session_state["mensagens"].append(f"🔁 Novo traço ou refazer por {usuario}")
        else:
            acao = "modificacao"

        # Envia para o backend
        asyncio.run(enviar_para_backend({
            "usuario": usuario,
            "tipo": "desenho",
            "acao": acao,
            "conteudo": current_data
        }))

# Entrada de texto (como no chat/dontpad)
entrada = st.text_input("Digite uma mensagem:")

if st.button("Enviar mensagem"):
    if entrada.strip():
        st.session_state["mensagens"].append(f"📤 {usuario}: {entrada}")
        asyncio.run(enviar_para_backend({"usuario": usuario, "tipo": "texto", "conteudo": entrada}))
        entrada = ""

# Mensagens
st.subheader("🗂 Histórico")
for m in st.session_state["mensagens"]:
    st.write(m)
