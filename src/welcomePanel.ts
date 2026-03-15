/**
 * WelcomePanel — A 3D welcome screen shown in VR before entering the time machine.
 * Uses canvas-rendered text on a plane. MeshBasicMaterial only (Quest-safe).
 * Supports XR controller raycasting and desktop mouse click.
 */

import * as THREE from "three";

export class WelcomePanel {
  private root: THREE.Group;
  private scene: THREE.Scene;
  private onEnter: () => void;
  private enterBtn: THREE.Mesh;
  private enterMat: THREE.MeshBasicMaterial;
  private raycaster = new THREE.Raycaster();
  private tempMatrix = new THREE.Matrix4();
  private pointer = new THREE.Vector2(-9, -9);
  private camera: THREE.Camera | null = null;
  private hovered = false;
  private controllersSetUp = false;

  constructor(scene: THREE.Scene, onEnter: () => void) {
    this.scene = scene;
    this.onEnter = onEnter;

    this.root = new THREE.Group();
    this.root.position.set(0, 2.5, -2.0);
    this.root.visible = true;
    scene.add(this.root);

    // Background panel
    const bgMat = new THREE.MeshBasicMaterial({
      color: 0x0a0a1e,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), bgMat);
    this.root.add(bg);

    // Border glow
    const borderMat = new THREE.MeshBasicMaterial({
      color: 0x6644cc,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
    });
    const border = new THREE.Mesh(new THREE.PlaneGeometry(1.44, 0.94), borderMat);
    border.position.z = -0.001;
    this.root.add(border);

    // Title texture
    const titleCanvas = this.createTextCanvas(
      "TIME MACHINE",
      512, 80,
      "bold 48px Orbitron, sans-serif",
      "#c8b8ff",
    );
    const titleTex = new THREE.CanvasTexture(titleCanvas);
    const titleMat = new THREE.MeshBasicMaterial({
      map: titleTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const titleMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.16), titleMat);
    titleMesh.position.y = 0.2;
    titleMesh.position.z = 0.001;
    this.root.add(titleMesh);


    // Enter button
    const btnCanvas = this.createTextCanvas(
      "ENTER THE TIME MACHINE",
      512, 64,
      "bold 28px Orbitron, sans-serif",
      "#c8b8ff",
    );
    const btnTex = new THREE.CanvasTexture(btnCanvas);
    this.enterMat = new THREE.MeshBasicMaterial({
      color: 0x6644cc,
      transparent: true,
      opacity: 0.8,
    });
    this.enterBtn = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.14), this.enterMat);
    this.enterBtn.position.y = -0.15;
    this.enterBtn.position.z = 0.002;
    this.root.add(this.enterBtn);

    // Button label on top
    const btnLabelMat = new THREE.MeshBasicMaterial({
      map: btnTex,
      transparent: true,
      side: THREE.DoubleSide,
    });
    const btnLabel = new THREE.Mesh(new THREE.PlaneGeometry(0.75, 0.1), btnLabelMat);
    btnLabel.position.y = -0.15;
    btnLabel.position.z = 0.003;
    this.root.add(btnLabel);

    // Border around button
    const btnBorderMat = new THREE.MeshBasicMaterial({
      color: 0x8866ff,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
    });
    const btnBorder = new THREE.Mesh(new THREE.PlaneGeometry(0.84, 0.18), btnBorderMat);
    btnBorder.position.y = -0.15;
    btnBorder.position.z = 0.001;
    this.root.add(btnBorder);
  }

  private createTextCanvas(
    text: string,
    width: number,
    height: number,
    font: string,
    color: string,
  ): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, width, height);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, width / 2, height / 2);
    return canvas;
  }

  setupDesktopPointer(canvas: HTMLCanvasElement, camera: THREE.Camera): void {
    this.camera = camera;

    canvas.addEventListener("pointermove", (e: PointerEvent) => {
      this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    canvas.addEventListener("pointerdown", (e: PointerEvent) => {
      if (e.button !== 0 || !this.root.visible) return;
      this.raycaster.setFromCamera(this.pointer, camera);
      const hits = this.raycaster.intersectObject(this.enterBtn);
      if (hits.length > 0) {
        this.hide();
        this.onEnter();
      }
    });

    canvas.addEventListener("pointermove", () => {
      if (!this.root.visible || !this.camera) return;
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const hits = this.raycaster.intersectObject(this.enterBtn);
      const wasHovered = this.hovered;
      this.hovered = hits.length > 0;
      if (this.hovered !== wasHovered) {
        this.enterMat.opacity = this.hovered ? 1.0 : 0.8;
        canvas.style.cursor = this.hovered ? "pointer" : "default";
      }
    });
  }

  tick(delta: number, renderer: THREE.WebGLRenderer): void {
    if (!this.root.visible) return;

    // Pulse the button
    const t = performance.now() * 0.001;
    this.enterMat.opacity = this.hovered ? 1.0 : 0.6 + Math.sin(t * 2.5) * 0.2;

    // XR controller setup
    if (!this.controllersSetUp && renderer.xr.isPresenting) {
      this.setupXRControllers(renderer);
      this.controllersSetUp = true;
    }

    // XR raycasting
    if (renderer.xr.isPresenting) {
      this.tickXRRaycasting(renderer);
    }
  }

  private rayLines: THREE.Line[] = [];

  private setupXRControllers(renderer: THREE.WebGLRenderer): void {
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);

      controller.addEventListener("selectstart", () => {
        if (!this.root.visible) return;
        const hovIdx = (controller as any).userData.welcomeHovered;
        if (hovIdx) {
          this.hide();
          this.onEnter();
        }
      });

      // Ray line
      const pts = [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -5)];
      const rayMat = new THREE.LineBasicMaterial({
        color: 0x8866ff,
        transparent: true,
        opacity: 0.5,
      });
      const rayLine = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        rayMat,
      );
      rayLine.frustumCulled = false;
      controller.add(rayLine);
      this.rayLines.push(rayLine);

      // Reticle dot
      const dot = new THREE.Mesh(
        new THREE.CircleGeometry(0.004, 12),
        new THREE.MeshBasicMaterial({
          color: 0xcc99ff,
          side: THREE.DoubleSide,
        }),
      );
      dot.position.z = -0.015;
      dot.rotation.x = -Math.PI / 2;
      controller.add(dot);
    }
  }

  private tickXRRaycasting(renderer: THREE.WebGLRenderer): void {
    for (let i = 0; i < 2; i++) {
      const controller = renderer.xr.getController(i);
      this.tempMatrix.identity().extractRotation(controller.matrixWorld);
      this.raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
      this.raycaster.ray.direction.set(0, 0, -1).applyMatrix4(this.tempMatrix);

      const hits = this.raycaster.intersectObject(this.enterBtn);
      const hovered = hits.length > 0;
      (controller as any).userData.welcomeHovered = hovered;

      // Change ray color on hover
      if (this.rayLines[i]) {
        const mat = this.rayLines[i].material as THREE.LineBasicMaterial;
        mat.color.setHex(hovered ? 0xffcc44 : 0x8866ff);
        mat.opacity = hovered ? 0.8 : 0.5;
      }
    }
  }

  show(): void {
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    this.scene.remove(this.root);
  }
}
