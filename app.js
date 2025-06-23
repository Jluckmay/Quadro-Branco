class WhiteboardState {
    constructor() {
        this.objects = [];
        this.undoHistory = [];
        this.redoHistory = [];
        this.actionHistory = [];
    }

    addObject(obj) {
        this.objects.push(obj);
        this.redoHistory = [];
        this.undoHistory = [];
        return this.objects.length - 1;
    }

    removeObject(index) {
        const removedObject = this.objects.splice(index, 1)[0];
        this.redoHistory = [];
        this.undoHistory = [];
        return removedObject;
    }

    undo() {
        if (this.objects.length > 0) {
            const removedObject = this.objects.pop();
            this.undoHistory.push(removedObject);
            this.redoHistory.push(removedObject);
            return removedObject;
        }
        return null;
    }

    redo() {
        if (this.redoHistory.length > 0) {
            const redoObject = this.redoHistory.pop();
            this.objects.push(redoObject);
            return redoObject;
        }
        return null;
    }

    getObjects() {
        return this.objects;
    }

    recordAction(action) {
        this.actionHistory.push(action);
        this.redoHistory = [];
        this.undoHistory = [];
    }

    undoLastAction() {
        if (this.actionHistory.length === 0) return null;
        const lastAction = this.actionHistory.pop();
        return lastAction;
    }

    restoreState(listaDoBackend) {
        this.objects = listaDoBackend
            .filter(obj => obj.acao === 'novo_objeto' && obj.conteudo)
            .map(obj => {
                const parsed = typeof obj.conteudo === 'string'
                    ? JSON.parse(obj.conteudo)
                    : obj.conteudo;
                console.log("🎨 Restaurando objeto:", parsed);
                return parsed;
            });
        this.actionHistory = [];
    }

}


class WhiteboardApp {
        constructor() {
            this.canvas = document.getElementById('whiteboard');
            this.ctx = this.canvas.getContext('2d');
            this.colorPicker = document.getElementById('color-picker');

            this.state = new WhiteboardState();

            this.currentTool = 'pencil';
            this.isDrawing = false;
            this.selectedObjects = [];

            this.lockedObjects = {}; 

            this.currentColor = '#000000';
            this.currentObject = null;
            this.startX = 0;
            this.startY = 0;

            this.isDraggingObject = false;
            this.dragOffsetX = 0;
            this.dragOffsetY = 0;

            this.selectionColor = 'rgba(0, 123, 255, 0.3)';
            this.usuarioEmail = localStorage.getItem("usuario_email") || "anonimo@sememail.com";

            // Multiplayer setup
            this.room = null;
            this.socket = null;

            this.initializeCanvas();
            this.setupEventListeners();
            this.setupMultiplayer();
            this.setupLocalDrawingSync()
            this.connectWebSocket();
        }

handleObjectSelection(e) {
    // Evita conflito de clique durante arrasto
    if (this.isDraggingObject) {
        console.log("⚠️ Ignorando clique: já está arrastando um objeto.");
        return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.lastClickX = x;
    this.lastClickY = y;
    this.lockRequestPending = null;
    this.selectedObjects = [];

    this.state.getObjects().forEach((obj, index) => {
        const lockedBy = this.lockedObjects?.[index];
        const currentUser = this.usuarioEmail;

        if (lockedBy && lockedBy !== currentUser) {
            console.log(`🔒 Objeto ${index} está bloqueado por ${lockedBy}.`);
            return; // ignora objetos bloqueados por outro usuário
        }

        if (this.selectedObjects.length > 0) return; // seleciona apenas o primeiro objeto válido

        let isSelected = false;
        switch (obj.type) {
            case 'text':
                isSelected = this.isPointNearText(x, y, obj);
                break;
            case 'rect':
                isSelected = this.isPointNearRect(x, y, obj);
                break;
            case 'circle':
                isSelected = this.isPointNearCircle(x, y, obj);
                break;
            case 'pencil':
                isSelected = this.isPointNearPencilPath(x, y, obj);
                break;
            case 'line':
                isSelected = this.isPointNearLine(x, y, obj);
                break;
            case 'star':
                isSelected = this.isPointNearStar(x, y, obj);
                break;
            case 'arrow':
                isSelected = this.isPointNearArrow(x, y, obj);
                break;
            case 'polygon':
                isSelected = this.isPointNearPolygon(x, y, obj);
                break;
        }

        if (isSelected) {
            this.selectedObjects.push(obj);
            this.lockRequestPending = index;

            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                console.log(`🔒 Solicitando lock para o objeto ${index}`);
                this.socket.send(JSON.stringify({
                    tipo: "lock",
                    acao: "adquirir",
                    conteudo: { index }
                }));
            }
        }
    });

}


stopDraggingObject(e) {
    if (this.isDraggingObject && this.selectedObjects.length > 0) {
        const obj = this.selectedObjects[0];
        const index = this.state.objects.indexOf(obj);

        if (index !== -1 && this.socket && this.socket.readyState === WebSocket.OPEN) {
            // Envia a movimentação ao backend
            this.socket.send(JSON.stringify({
                usuario: this.usuarioEmail,
                tipo: "desenho",
                acao: "mover_objeto",
                conteudo: { index, objeto: obj }
            }));

            // Libera o lock do objeto
            this.socket.send(JSON.stringify({
                tipo: "lock",
                acao: "liberar",
                conteudo: { index }
            }));

            console.log(`✅ Objeto ${index} movido e lock liberado.`);
        }
    }

    this.isDraggingObject = false;
    this.selectedObjects = [];
    this.redrawCanvas();
}


    initializeCanvas() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight - 60;
        this.redrawCanvas();
    }

    setupEventListeners() {
        document.querySelectorAll('.dropdown-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.selectTool(e.target.dataset.tool);
                // Close dropdown
                const dropdown = document.getElementById('geometric-shapes-dropdown');
                const bsDropdown = bootstrap.Dropdown.getInstance(dropdown);
                if (bsDropdown) {
                    bsDropdown.hide();
                }
            });
        });

        document.querySelectorAll('.tool-btn:not(.dropdown-toggle)').forEach(btn => {
            btn.addEventListener('click', (e) => this.selectTool(e.target.dataset.tool));
        });

        this.colorPicker.addEventListener('change', (e) => {
            this.currentColor = e.target.value;
        });

        this.canvas.addEventListener('mousedown', (e) => {
            if (this.currentTool === 'eraser') {
                this.handleDeletion(e);
            } else {
                this.startDrawing(e);
            }
        });
        this.canvas.addEventListener('mousemove', (e) => {
            if (this.currentTool === 'move' && this.isDraggingObject) {
                this.dragSelectedObject(e);
            } else if (this.currentTool === 'eraser') {
                this.draw(e);
            } else {
                this.draw(e);
            }
        });
        this.canvas.addEventListener('mouseup', (e) => {
            if (this.currentTool === 'move' && this.isDraggingObject) {
                this.stopDraggingObject(e);
            } else {
                this.stopDrawing(e);
            }
        });
        this.canvas.addEventListener('mouseout', () => this.stopDrawing());

        document.getElementById('undo-btn').addEventListener('click', () => this.undo());
        document.getElementById('redo-btn').addEventListener('click', () => this.redo());

        document.getElementById('join-room-btn').addEventListener('click', () => this.initializeMultiplayerRoom());


        document.getElementById('dark-mode-toggle').addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
        });
    }

    selectTool(tool) {
        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.remove('active');
        });

        document.querySelector(`[data-tool="${tool}"]`).classList.add('active');

        this.currentTool = tool;
        this.selectedObjects = [];
    }

    startDrawing(e) {
        this.isDrawing = true;
        const rect = this.canvas.getBoundingClientRect();
        this.startX = e.clientX - rect.left;
        this.startY = e.clientY - rect.top;

        switch (this.currentTool) {
            case 'pencil':
                this.ctx.beginPath();
                this.ctx.moveTo(this.startX, this.startY);
                this.currentObject = {
                    type: 'pencil',
                    points: [{ x: this.startX, y: this.startY }],
                    color: this.currentColor
                };
                break;
            case 'rect':
            case 'circle':
            case 'line':
            case 'star':
            case 'arrow':
            case 'polygon':
                this.currentObject = {
                    type: this.currentTool,
                    startX: this.startX,
                    startY: this.startY,
                    color: this.currentColor
                };
                break;
            case 'text':
                const text = prompt('Enter text:');
                if (text) {
                    this.drawText(text, this.startX, this.startY);
                }
                break;
            case 'delete':
                this.handleDeletion(e);
                break;
            case 'move':
                this.handleObjectSelection(e);
                break;
        }
    }

        draw(e) {
            if (!this.isDrawing) return;

            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;

            this.ctx.strokeStyle = this.currentColor;
            this.ctx.fillStyle = this.currentColor;

            switch (this.currentTool) {
                case 'eraser':
                    const objects = this.state.getObjects();
                    let apagou = false;

                    for (let i = objects.length - 1; i >= 0; i--) {
                        if (this.isObjectNearPoint(x, y, objects[i], 20)) {
                            this.state.removeObject(i); // isso já envia para o backend
                            apagou = true;
                        }
                    }

                    if (apagou) {
                        this.state.recordAction({
                            type: 'delete',
                            objects: [] // você pode melhorar isso registrando os apagados se quiser
                        });
                    }

                    this.redrawCanvas();
                    break;

                case 'pencil':
                    this.ctx.lineTo(x, y);
                    this.ctx.lineWidth = 2;
                    this.ctx.lineCap = 'round';
                    this.ctx.stroke();
                    this.currentObject.points.push({ x, y });
                    break;

                case 'rect':
                    this.redrawCanvas();
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = this.currentColor;
                    this.ctx.strokeRect(
                        Math.min(this.startX, x),
                        Math.min(this.startY, y),
                        Math.abs(x - this.startX),
                        Math.abs(y - this.startY)
                    );
                    break;

                case 'circle':
                    this.redrawCanvas();
                    const radius = Math.sqrt(
                        Math.pow(x - this.startX, 2) +
                        Math.pow(y - this.startY, 2)
                    );
                    this.ctx.beginPath();
                    this.ctx.strokeStyle = this.currentColor;
                    this.ctx.arc(this.startX, this.startY, radius, 0, 2 * Math.PI);
                    this.ctx.stroke();
                    break;

                case 'line':
                case 'star':
                case 'arrow':
                case 'polygon':
                    this.redrawCanvas();
                    const newObject = this.drawGeometricShape(this.currentTool, this.startX, this.startY, x, y);
                    this.currentObject = newObject;
                    break;
            }
        }


    stopDrawing(e) {
        if (!this.isDrawing) return;

        this.isDrawing = false;

        switch (this.currentTool) {
            case 'pencil':
                if (this.currentObject && this.currentObject.points.length > 1) {
                    const index = this.state.addObject(this.currentObject);
                    this.state.recordAction({
                        type: 'add',
                        objectIndex: index
                    });
                }
                break;
            case 'rect':
                const rect = this.canvas.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;

                const newObject = {
                    type: 'rect',
                    startX: this.startX,
                    startY: this.startY,
                    endX: x,
                    endY: y,
                    color: this.currentColor
                };
                const index = this.state.addObject(newObject);
                this.state.recordAction({
                    type: 'add',
                    objectIndex: index
                });
                break;
            case 'circle':
                const circleRect = this.canvas.getBoundingClientRect();
                const circleX = e.clientX - circleRect.left;
                const circleY = e.clientY - circleRect.top;

                const newCircleObject = {
                    type: 'circle',
                    startX: this.startX,
                    startY: this.startY,
                    endX: circleX,
                    endY: circleY,
                    color: this.currentColor
                };
                const circleIndex = this.state.addObject(newCircleObject);
                this.state.recordAction({
                    type: 'add',
                    objectIndex: circleIndex
                });
                break;
            case 'line':
            case 'star':
            case 'arrow':
            case 'polygon':
                if (this.currentObject) {
                    const index = this.state.addObject(this.currentObject);
                    this.state.recordAction({
                        type: 'add',
                        objectIndex: index
                    });
                }
                break;
            case 'text':
                break;
        }

        this.currentObject = null;
        this.redrawCanvas();
    }

    drawText(text, x, y) {
        const textObject = {
            type: 'text',
            text: text,
            x: x,
            y: y,
            color: this.currentColor,
            width: 0,
            height: 16
        };

        this.state.addObject(textObject);
        this.redrawCanvas();
    }

    undo() {
        const lastAction = this.state.undoLastAction();

        if (lastAction) {
            switch (lastAction.type) {
                case 'add':
                    if (this.state.objects.length > 0) {
                        this.state.undo();
                    }
                    break;
                case 'delete':
                    if (lastAction.objects) {
                        lastAction.objects.forEach(obj => {
                            this.state.objects.push(obj);
                        });
                    }
                    break;
                case 'move':
                    if (lastAction.originalPositions) {
                        lastAction.originalPositions.forEach((originalPos, index) => {
                            const obj = this.state.objects[index];
                            if (obj) {
                                switch (obj.type) {
                                    case 'text':
                                        obj.x = originalPos.x;
                                        obj.y = originalPos.y;
                                        break;
                                    case 'rect':
                                    case 'circle':
                                        obj.startX = originalPos.startX;
                                        obj.startY = originalPos.startY;
                                        obj.endX = originalPos.endX;
                                        obj.endY = originalPos.endY;
                                        break;
                                    case 'pencil':
                                        obj.points = originalPos.points;
                                        break;
                                    case 'line':
                                    case 'star':
                                    case 'arrow':
                                    case 'polygon':
                                        obj.startX = originalPos.startX;
                                        obj.startY = originalPos.startY;
                                        obj.endX = originalPos.endX;
                                        obj.endY = originalPos.endY;
                                        break;
                                }
                            }
                        });
                    }
                    break;
            }

            this.redrawCanvas();
        }
    }

    redo() {
        const redoObject = this.state.redo();
        if (redoObject) {
            this.redrawCanvas();
        }
    }

    handleDeletion(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (this.currentTool === 'delete') {
            // Clear everything on the board
            const allObjects = this.state.getObjects();
            if (allObjects.length > 0) {
                this.state.recordAction({
                    type: 'delete',
                    objects: [...allObjects]
                });

                // Clear the state completely
                this.state.objects = [];
                this.state.undoHistory = [];
                this.state.redoHistory = [];
            }

            this.redrawCanvas();
            return;
        }

        // Existing point-based deletion logic
        const erasedObjects = [];

        const objects = this.state.getObjects();
        for (let i = objects.length - 1; i >= 0; i--) {
            const obj = objects[i];
            if (this.isObjectNearPoint(x, y, obj, 20)) {
                erasedObjects.push(obj);
                this.state.removeObject(i);
            }
        }

        if (erasedObjects.length > 0) {
            this.state.recordAction({
                type: 'delete',
                objects: erasedObjects
            });
        }

        this.redrawCanvas();
    }

    isObjectNearPoint(x, y, obj, threshold = 10) {
        switch (obj.type) {
            case 'text':
                return this.isPointNearText(x, y, obj, threshold);
            case 'rect':
                return this.isPointNearRect(x, y, obj, threshold);
            case 'circle':
                return this.isPointNearCircle(x, y, obj, threshold);
            case 'pencil':
                return this.isPointNearPencilPath(x, y, obj, threshold);
            case 'line':
                return this.isPointNearLine(x, y, obj, threshold);
            case 'star':
                return this.isPointNearStar(x, y, obj, threshold);
            case 'arrow':
                return this.isPointNearArrow(x, y, obj, threshold);
            case 'polygon':
                return this.isPointNearPolygon(x, y, obj, threshold);
            default:
                return false;
        }
    }

    isPointNearText(x, y, textObj, threshold = 10) {
        return (
            x >= textObj.x - threshold &&
            x <= textObj.x + textObj.width + threshold &&
            y >= textObj.y - textObj.height - threshold &&
            y <= textObj.y + threshold
        );
    }

    isPointNearRect(x, y, rectObj, threshold = 10) {
        const minX = Math.min(rectObj.startX, rectObj.endX);
        const maxX = Math.max(rectObj.startX, rectObj.endX);
        const minY = Math.min(rectObj.startY, rectObj.endY);
        const maxY = Math.max(rectObj.startY, rectObj.endY);

        return (x >= minX - threshold && x <= maxX + threshold &&
            y >= minY - threshold && y <= maxY + threshold);
    }

    isPointNearCircle(x, y, circleObj, threshold = 10) {
        const centerX = circleObj.startX;
        const centerY = circleObj.startY;
        const radius = Math.sqrt(
            Math.pow(circleObj.endX - centerX, 2) +
            Math.pow(circleObj.endY - centerY, 2)
        );

        const distanceFromCenter = Math.sqrt(
            Math.pow(x - centerX, 2) +
            Math.pow(y - centerY, 2)
        );

        return Math.abs(distanceFromCenter - radius) <= threshold;
    }

    isPointNearPencilPath(x, y, pencilObj, threshold = 10) {
        return pencilObj.points.some(point =>
            Math.abs(x - point.x) < threshold &&
            Math.abs(y - point.y) < threshold
        );
    }

    isPointNearLine(x, y, lineObj, threshold = 10) {
        const minX = Math.min(lineObj.startX, lineObj.endX);
        const maxX = Math.max(lineObj.startX, lineObj.endX);
        const minY = Math.min(lineObj.startY, lineObj.endY);
        const maxY = Math.max(lineObj.startY, lineObj.endY);

        return (x >= minX - threshold && x <= maxX + threshold &&
            y >= minY - threshold && y <= maxY + threshold);
    }

    isPointNearStar(x, y, starObj, threshold = 10) {
        const centerX = starObj.centerX;
        const centerY = starObj.centerY;
        const radius = starObj.size;

        const distanceFromCenter = Math.sqrt(
            Math.pow(x - centerX, 2) +
            Math.pow(y - centerY, 2)
        );

        return Math.abs(distanceFromCenter - radius) <= threshold;
    }

    isPointNearArrow(x, y, arrowObj, threshold = 10) {
        const minX = Math.min(arrowObj.startX, arrowObj.endX);
        const maxX = Math.max(arrowObj.startX, arrowObj.endX);
        const minY = Math.min(arrowObj.startY, arrowObj.endY);
        const maxY = Math.max(arrowObj.startY, arrowObj.endY);

        return (x >= minX - threshold && x <= maxX + threshold &&
            y >= minY - threshold && y <= maxY + threshold);
    }

    isPointNearPolygon(x, y, polygonObj, threshold = 10) {
        const centerX = polygonObj.centerX;
        const centerY = polygonObj.centerY;
        const radius = polygonObj.radius;

        const distanceFromCenter = Math.sqrt(
            Math.pow(x - centerX, 2) +
            Math.pow(y - centerY, 2)
        );

        return Math.abs(distanceFromCenter - radius) <= threshold;
    }

   

        dragSelectedObject(e) {
        if (!this.isDraggingObject || this.selectedObjects.length === 0) return;

        const index = this.state.getObjects().indexOf(this.selectedObjects[0]);
        const lockedBy = this.lockedObjects[index];

        if (lockedBy && lockedBy !== this.usuarioEmail) {
            console.log(`🚫 Você não tem permissão para mover o objeto ${index}.`);
            return;
        }

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const obj = this.selectedObjects[0];

        // Atualiza posição com base no tipo
        switch (obj.type) {
            case 'text':
                obj.x = x - this.dragOffsetX;
                obj.y = y - this.dragOffsetY;
                break;
            case 'rect':
            case 'circle':
            case 'line':
            case 'star':
            case 'arrow':
            case 'polygon':
                const deltaX = x - this.dragOffsetX - Math.min(obj.startX, obj.endX);
                const deltaY = y - this.dragOffsetY - Math.min(obj.startY, obj.endY);
                obj.startX += deltaX;
                obj.endX += deltaX;
                obj.startY += deltaY;
                obj.endY += deltaY;
                break;
            case 'pencil':
                const offsetX = x - this.dragOffsetX;
                const offsetY = y - this.dragOffsetY;
                const deltaPX = offsetX - obj.points[0].x;
                const deltaPY = offsetY - obj.points[0].y;
                obj.points.forEach(p => {
                    p.x += deltaPX;
                    p.y += deltaPY;
                });
                break;
        }

        // Enviar atualização
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({
                tipo: "desenho",
                acao: "mover_objeto",
                conteudo: {
                    index,
                    objeto: obj
                },
                usuario: this.usuarioEmail
            }));
        }

        this.redrawCanvas();
    }


    stopDraggingObject(e) {
        if (this.socket && this.socket.readyState === WebSocket.OPEN) {
            this.selectedObjects.forEach(obj => {
                const index = this.state.objects.indexOf(obj);
                if (index !== -1) {
                    this.socket.send(JSON.stringify({
                        usuario: this.usuarioEmail,
                        tipo: "desenho",
                        acao: "mover_objeto",
                        conteudo: { index, objeto: obj }
                    }));
                }
            });
        }

        this.isDraggingObject = false;
        this.selectedObjects = [];
        this.redrawCanvas();
    }


    drawGeometricShape(type, startX, startY, endX, endY) {
        let newObject = null;
        switch (type) {
            case 'line':
                GeometricShapes.drawLine(this.ctx, startX, startY, endX, endY, this.currentColor);
                newObject = {
                    type: 'line',
                    startX: startX,
                    startY: startY,
                    endX: endX,
                    endY: endY,
                    color: this.currentColor
                };
                break;
            case 'star':
                const size = Math.sqrt(
                    Math.pow(endX - startX, 2) +
                    Math.pow(endY - startY, 2)
                );
                GeometricShapes.drawStar(this.ctx, startX, startY, size, this.currentColor);
                newObject = {
                    type: 'star',
                    centerX: startX,
                    centerY: startY,
                    size: size,
                    color: this.currentColor
                };
                break;
            case 'arrow':
                // Calculate arrow head orientation based on line direction
                const angle = Math.atan2(endY - startY, endX - startX);
                const headLength = Math.sqrt(
                    Math.pow(endX - startX, 2) +
                    Math.pow(endY - startY, 2)
                ) * 0.2; // Arrow head length proportional to arrow length

                GeometricShapes.drawArrow(this.ctx, startX, startY, endX, endY, this.currentColor, angle, headLength);
                newObject = {
                    type: 'arrow',
                    startX: startX,
                    startY: startY,
                    endX: endX,
                    endY: endY,
                    color: this.currentColor,
                    angle: angle,
                    headLength: headLength
                };
                break;
            case 'polygon':
                const radius = Math.sqrt(
                    Math.pow(endX - startX, 2) +
                    Math.pow(endY - startY, 2)
                );
                const sides = 6; // Default hexagon, could be made configurable
                GeometricShapes.drawPolygon(this.ctx, startX, startY, sides, radius, this.currentColor);
                newObject = {
                    type: 'polygon',
                    centerX: startX,
                    centerY: startY,
                    sides: sides,
                    radius: radius,
                    color: this.currentColor
                };
                break;
        }
        return newObject;
    }

    redrawCanvas() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const objects = this.state.getObjects();

    objects.forEach(obj => {
        const isSelected = this.selectedObjects.includes(obj);
        this.ctx.strokeStyle = obj.color || '#000';
        this.ctx.fillStyle = obj.color || '#000';

        switch (obj.type) {
            case 'pencil':
                if (obj.points?.length > 1) {
                    this.ctx.beginPath();
                    this.ctx.moveTo(obj.points[0].x, obj.points[0].y);
                    obj.points.slice(1).forEach(point => {
                        this.ctx.lineTo(point.x, point.y);
                    });
                    this.ctx.lineWidth = 2;
                    this.ctx.lineCap = 'round';
                    this.ctx.stroke();

                    if (isSelected) this.drawSelectionHighlight(obj.points);
                }
                break;

            case 'rect':
                const rectX = Math.min(obj.startX, obj.endX);
                const rectY = Math.min(obj.startY, obj.endY);
                const rectW = Math.abs(obj.endX - obj.startX);
                const rectH = Math.abs(obj.endY - obj.startY);

                if (isSelected) {
                    this.ctx.fillStyle = this.selectionColor;
                    this.ctx.fillRect(rectX, rectY, rectW, rectH);
                    this.ctx.fillStyle = obj.color || '#000';
                }

                this.ctx.strokeRect(rectX, rectY, rectW, rectH);
                break;

            case 'circle':
                const radius = Math.sqrt(
                    Math.pow(obj.endX - obj.startX, 2) +
                    Math.pow(obj.endY - obj.startY, 2)
                );

                if (isSelected) {
                    this.ctx.beginPath();
                    this.ctx.fillStyle = this.selectionColor;
                    this.ctx.arc(obj.startX, obj.startY, radius, 0, 2 * Math.PI);
                    this.ctx.fill();
                    this.ctx.fillStyle = obj.color || '#000';
                }

                this.ctx.beginPath();
                this.ctx.arc(obj.startX, obj.startY, radius, 0, 2 * Math.PI);
                this.ctx.stroke();
                break;

            case 'text':
                this.ctx.font = '16px Arial';
                const metrics = this.ctx.measureText(obj.text);
                obj.width = metrics.width;
                obj.height = 16;

                if (isSelected) {
                    this.ctx.fillStyle = this.selectionColor;
                    this.ctx.fillRect(obj.x, obj.y - obj.height, obj.width, obj.height);
                    this.ctx.fillStyle = obj.color || '#000';
                }

                this.ctx.fillText(obj.text, obj.x, obj.y);
                break;

            case 'line':
                if (isSelected) {
                    this.ctx.fillStyle = this.selectionColor;
                    this.ctx.beginPath();
                    this.ctx.moveTo(obj.startX, obj.startY);
                    this.ctx.lineTo(obj.endX, obj.endY);
                    this.ctx.lineTo((obj.startX + obj.endX) / 2, (obj.startY + obj.endY) / 2);
                    this.ctx.fill();
                    this.ctx.fillStyle = obj.color || '#000';
                }

                this.ctx.beginPath();
                this.ctx.moveTo(obj.startX, obj.startY);
                this.ctx.lineTo(obj.endX, obj.endY);
                this.ctx.stroke();
                break;

            case 'star':
                const size = obj.size || 20;
                const outerRadius = size;
                const innerRadius = size / 2;
                const points = 5;

                const drawStar = (fill = false) => {
                    this.ctx.beginPath();
                    for (let i = 0; i < points * 2; i++) {
                        const angle = (i * Math.PI) / points - Math.PI / 2;
                        const radius = i % 2 === 0 ? outerRadius : innerRadius;
                        const x = obj.centerX + radius * Math.cos(angle);
                        const y = obj.centerY + radius * Math.sin(angle);
                        if (i === 0) this.ctx.moveTo(x, y);
                        else this.ctx.lineTo(x, y);
                    }
                    this.ctx.closePath();
                    if (fill) this.ctx.fill();
                    else this.ctx.stroke();
                };

                if (isSelected) {
                    this.ctx.fillStyle = this.selectionColor;
                    drawStar(true);
                    this.ctx.fillStyle = obj.color || '#000';
                }

                drawStar(false);
                break;

            case 'arrow':
                if (isSelected) {
                    this.ctx.fillStyle = this.selectionColor;
                    this.ctx.beginPath();
                    this.ctx.moveTo(obj.startX, obj.startY);
                    this.ctx.lineTo(obj.endX, obj.endY);
                    this.ctx.stroke();
                    this.ctx.fillStyle = obj.color || '#000';
                }

                GeometricShapes.drawArrow(
                    this.ctx,
                    obj.startX,
                    obj.startY,
                    obj.endX,
                    obj.endY,
                    obj.color,
                    obj.angle,
                    obj.headLength
                );
                break;

            case 'polygon':
                const polygonRadius = obj.radius;
                const sides = obj.sides || 5;

                const drawPolygon = (fill = false) => {
                    this.ctx.beginPath();
                    for (let i = 0; i <= sides; i++) {
                        const angle = (i * 2 * Math.PI) / sides;
                        const x = obj.centerX + polygonRadius * Math.cos(angle);
                        const y = obj.centerY + polygonRadius * Math.sin(angle);
                        if (i === 0) this.ctx.moveTo(x, y);
                        else this.ctx.lineTo(x, y);
                    }
                    this.ctx.closePath();
                    if (fill) this.ctx.fill();
                    else this.ctx.stroke();
                };

                if (isSelected) {
                    this.ctx.fillStyle = this.selectionColor;
                    drawPolygon(true);
                    this.ctx.fillStyle = obj.color || '#000';
                }

                drawPolygon(false);
                break;
        }
    });
}


    drawSelectionHighlight(points) {
        if (points.length < 2) return;

        this.ctx.beginPath();
        this.ctx.moveTo(points[0].x, points[0].y);
        points.slice(1).forEach(point => {
            this.ctx.lineTo(point.x, point.y);
        });

        this.ctx.lineWidth = 10;
        this.ctx.lineCap = 'round';
        this.ctx.strokeStyle = this.selectionColor;
        this.ctx.stroke();
    }

    setupMultiplayer() {
        const joinRoomBtn = document.getElementById('join-room-btn');
        joinRoomBtn.addEventListener('click', () => this.initializeMultiplayerRoom());
    }

    async initializeMultiplayerRoom() {
        const username = document.getElementById('username').value.trim();
        const roomCode = document.getElementById('room-code').value.trim();

        if (!username || !roomCode) {
            alert('Please enter both username and room code');
            return;
        }

        try {
            // Initialize WebsimSocket room
            this.room = new WebsimSocket();
            await this.room.initialize();

            // Subscribe to room state updates
            this.room.subscribeRoomState((roomState) => {
                this.updateCanvasFromRoomState(roomState);
            });

            // Subscribe to presence updates for other users' actions
            this.room.subscribePresence((presence) => {
                this.handleOtherUserPresence(presence);
            });

            // Setup local drawing synchronization
            this.setupLocalDrawingSync();

            // Close multiplayer modal
            const modal = bootstrap.Modal.getInstance(document.getElementById('multiplayer-modal'));
            modal.hide();

            alert(`Successfully joined room ${roomCode} as ${username}`);
        } catch (error) {
            console.error('Multiplayer initialization error:', error);
            alert('Failed to join multiplayer room. Please try again.');
        }
    }

    setupLocalDrawingSync() {
        // 🔄 Adiciona objeto
        const originalAddObject = this.state.addObject.bind(this.state);
        this.state.addObject = (obj) => {
            const index = originalAddObject(obj);
            
            if (this.room) {
                this.room.updateRoomState({
                    [`object_${index}`]: obj
                });
            }

            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                const msg = {
                    usuario: this.usuarioEmail,
                    tipo: "desenho",
                    acao: "novo_objeto",
                    conteudo: obj
                };
                console.log("📤 Enviando objeto via WebSocket:", msg);
                this.socket.send(JSON.stringify(msg));
            }

            return index;
        };
    
        // ❌ Remove objeto
        const originalRemoveObject = this.state.removeObject.bind(this.state);
        this.state.removeObject = (index) => {
            const removedObject = originalRemoveObject(index);

            if (this.room) {
                this.room.updateRoomState({
                    [`object_${index}`]: null
                });
            }

            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    usuario: this.usuarioEmail,
                    tipo: "desenho",
                    acao: "remover_objeto",
                    conteudo: { index: index }
                }));
            }

            return removedObject;
        };

        // 🧭 Envia movimentação quando ela acontecer
        const originalRecordAction = this.state.recordAction.bind(this.state);
        this.state.recordAction = (action) => {
            originalRecordAction(action);

            if (action.type === "move") {
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.selectedObjects.forEach(obj => {
                        const index = this.state.objects.indexOf(obj);
                        if (index !== -1) {
                            this.socket.send(JSON.stringify({
                                usuario: this.usuarioEmail,
                                tipo: "desenho",
                                acao: "mover_objeto",
                                conteudo: { index, objeto: obj }
                            }));
                        }
                    });
                }
            }
        };

        // 🕐 Undo
        const originalUndo = this.undo.bind(this);
        this.undo = () => {
            originalUndo();
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    usuario: this.usuarioEmail,
                    tipo: "desenho",
                    acao: "undo",
                    conteudo: this.state.getObjects()
                }));
            }
        };

        // 🔁 Redo
        const originalRedo = this.redo.bind(this);
        this.redo = () => {
            originalRedo();
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                this.socket.send(JSON.stringify({
                    usuario: this.usuarioEmail,
                    tipo: "desenho",
                    acao: "redo",
                    conteudo: this.state.getObjects()
                }));
            }
        };

        // 🧹 Botão Clean
        document.getElementById('delete-tool').addEventListener('click', () => {
            const allObjects = this.state.getObjects();

            // Grava histórico se houver objetos
            if (allObjects.length > 0) {
                this.state.recordAction({
                    type: 'delete',
                    objects: [...allObjects]
                });
            }

            // Limpa o estado do frontend
            this.state.objects = [];
            this.state.undoHistory = [];
            this.state.redoHistory = [];
            this.state.actionHistory = []; // também zera histórico de ações
            this.redrawCanvas();

            // Sempre envia o reset para o backend
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                console.log("🧹 Enviando reset para o backend");
                this.socket.send(JSON.stringify({
                    usuario: this.usuarioEmail,
                    tipo: "resetar",
                    conteudo: []
                }));
            } else {
                console.warn("❌ WebSocket indisponível para enviar reset");
            }
        });
    }

    updateCanvasFromRoomState(roomState) {
        // Clear current state and rebuild from room state
        this.state.objects = [];

        // Rebuild objects from room state
        Object.keys(roomState)
            .filter(key => key.startsWith('object_'))
            .forEach(key => {
                const obj = roomState[key];
                if (obj) {
                    this.state.objects.push(obj);
                }
            });

        // Redraw canvas
        this.redrawCanvas();
    }

    handleOtherUserPresence(presence) {
        // You can add additional logic to handle other users' presence if needed
        // For example, showing cursors or tracking active users
        console.log('Other users presence updated:', presence);
    }

    joinMultiplayerRoom() {
        console.warn('Use initializeMultiplayerRoom instead');
    }
    
connectWebSocket() {
    const token = localStorage.getItem("access_token");
    this.socket = new WebSocket(`wss://quadrobranco-ffap.onrender.com/ws/frontend?token=${token}`);

    this.socket.onopen = () => {
        console.log("✅ Conectado ao backend");
    };

this.socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log("📥 Mensagem do backend:", data);

    if (data.tipo === "estado_inicial") {
        if (Array.isArray(data.objetos)) {
            this.state.restoreState(data.objetos);
            console.log("🎯 Estado inicial restaurado com", data.objetos.length, "objetos.");
            this.redrawCanvas();
        }
        return;
    }

if (data.tipo === "lock") {
    const { acao, conteudo } = data;
    const index = conteudo.index;
    const usuarioId = conteudo.usuario_id;

    if (acao === "adquirido") {
        this.lockedObjects[index] = usuarioId;
        console.log(`🔐 Objeto ${index} bloqueado por ${usuarioId}`);

        // ✅ Verifica se foi o usuário atual que solicitou
        if (this.lockRequestPending === index && usuarioId === this.usuarioEmail) {
            const obj = this.state.getObjects()[index];
            this.selectedObjects = [obj];

            const x = this.lastClickX;
            const y = this.lastClickY;

            switch (obj.type) {
                case 'text':
                    this.dragOffsetX = x - obj.x;
                    this.dragOffsetY = y - obj.y;
                    break;
                case 'rect':
                case 'circle':
                case 'line':
                case 'star':
                case 'arrow':
                case 'polygon':
                    this.dragOffsetX = x - Math.min(obj.startX, obj.endX);
                    this.dragOffsetY = y - Math.min(obj.startY, obj.endY);
                    break;
                case 'pencil':
                    this.dragOffsetX = x - obj.points[0].x;
                    this.dragOffsetY = y - obj.points[0].y;
                    break;
            }

            this.redrawCanvas();
        }

    } else if (acao === "negado") {
        this.lockedObjects[index] = usuarioId;
        console.warn(`🚫 Não foi possível bloquear o objeto ${index} (já está com ${usuarioId})`);

    } else if (acao === "liberado") {
        delete this.lockedObjects[index];
        console.log(`🔓 Objeto ${index} liberado`);
    }
    return;
}


    if (data.tipo === "resetar") {
        console.log("🧹 Mensagem de reset recebida!");
        this.state.objects = [];
        this.redrawCanvas();
        return;
    }

    if (data.tipo === "desenho") {
        switch (data.acao) {
            case "novo_objeto":
                this.state.objects.push(data.conteudo);
                break;

            case "remover_objeto":
                const idx = data.conteudo.index;
                if (typeof idx === "number" && idx >= 0 && idx < this.state.objects.length) {
                    this.state.objects.splice(idx, 1);
                }
                break;

            case "mover_objeto":
                const moved = data.conteudo;
                if (moved.index >= 0) {
                    this.state.objects[moved.index] = moved.objeto;
                }
                break;

            case "undo":
            case "redo":
                this.state.objects = data.conteudo;
                break;
        }

        this.redrawCanvas();
    }
};




        this.socket.onclose = () => {
            console.warn("🔌 Conexão com backend encerrada");
        };

        this.socket.onerror = (error) => {
            console.error("❌ Erro na conexão WebSocket:", error);
        };
    }
    ;
}

GeometricShapes = {
    drawLine: (ctx, startX, startY, endX, endY, color) => {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.lineTo((startX + endX) / 2, (startY + endY) / 2);
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.stroke();
    },

    drawStar: (ctx, centerX, centerY, size, color) => {
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
            const angle = (i * 2 * Math.PI) / 5;
            const radius = (i % 2 === 0) ? size : size / 2;
            ctx.lineTo(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
        }
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.stroke();
    },

    drawArrow: (ctx, startX, startY, endX, endY, color, angle, headLength = 10) => {
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.strokeStyle = color;
        ctx.stroke();

        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(
            endX - headLength * Math.cos(angle - Math.PI / 6),
            endY - headLength * Math.sin(angle - Math.PI / 6)
        );
        ctx.lineTo(endX, endY);
        ctx.lineTo(
            endX - headLength * Math.cos(angle + Math.PI / 6),
            endY - headLength * Math.sin(angle + Math.PI / 6)
        );
        ctx.fill();
    },

    drawPolygon: (ctx, centerX, centerY, sides, radius, color) => {
        ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = (i * 2 * Math.PI) / sides;
            ctx.lineTo(centerX + radius * Math.cos(angle), centerY + radius * Math.sin(angle));
        }
        ctx.closePath();
        ctx.strokeStyle = color;
        ctx.stroke();
    }
};


window.addEventListener('load', () => {
    new WhiteboardApp();
});
