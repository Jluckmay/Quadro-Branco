# 🧑‍🤝‍🧑 Quadro Branco Colaborativo Distribuído

Projeto de um quadro branco colaborativo em tempo real com foco em comunicação distribuída, concorrência e sincronização entre múltiplos usuários.

## ✨ Funcionalidades
- Desenho em tempo real em sessões compartilhadas
- Inserção de texto e formas
- Sincronização instantânea entre clientes
- Interface leve e intuitiva
- Comunicação via WebSocket com backend distribuído

## 🎯 Objetivo
Este projeto foi desenvolvido como parte da disciplina de **Sistemas Distribuídos**, com o intuito de aplicar conceitos como:
- Comunicação assíncrona e indireta
- Controle de concorrência
- Tolerância a falhas
- Arquiteturas distribuídas com Pub/Sub ou WebSocket

## 🧰 Tecnologias utilizadas
- Frontend: HTML, CSS, JavaScript, Canvas API
- Backend: FastAPI, WebSocket, Supabase
- Deploy do frontend: GitHub Pages
- Deploy do backend: Render

## 🚀 Como executar
1. Clone o repositório.
2. Acesse o frontend em [https://jluckmay.github.io/Quadro-Branco/](https://jluckmay.github.io/Quadro-Branco/)
3. Conecte-se à sessão desejada.
4. Comece a desenhar com outras pessoas em tempo real!

## Para Executar Localmente

1. Primeiro, instale as dependências:
```
pip install -r requirements.txt
```

2. Altere o websocket, na linha 1222 do arquivo app.js, para o local: ws://127.0.0.1:8000/ws/frontend

3. Execute o backend:
```
uvicorn backend:app --reload
```

4. Abra o arquivo index.html em seu navegador

## Modo de Uso

Cada participante deve inserir seu nome ao entrar na aplicação.

A tela principal permite desenhar com o mouse e também enviar mensagens de texto.

As alterações no desenho são enviadas automaticamente ao backend.

A interface registra ações como:

🗣 envio de texto

✏️ modificação no desenho

↩️ desfazer

🗑 apagar a lousa


## 📄 Licença
MIT — veja o arquivo [LICENSE](./LICENSE) para mais detalhes.
