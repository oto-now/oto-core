// jsdom n'implémente ni `showModal()` ni `close()` de `<dialog>` (26.1) : les dialogues et la palette du
// design system porté (E05-S09) s'y ouvrent par leur attribut `open`, ce que fait le navigateur, sans la
// couche du dessus ni l'inertie du fond, que seuls les contrôles visuels voient.
// Ni `showPopover()` : la couche du dessus se tient ici dans l'ordre où l'on y entre, le dernier entré peint devant ;
// un test y lit qu'une infobulle ouverte dans un dialogue y passe après lui.
export const coucheDuDessus: Element[] = []

export function simulerLesDialogues(): void {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "")
    coucheDuDessus.push(this)
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open")
    const rang = coucheDuDessus.indexOf(this)
    if (rang >= 0) coucheDuDessus.splice(rang, 1)
  }
  HTMLElement.prototype.showPopover = function showPopover(this: HTMLElement) {
    coucheDuDessus.push(this)
  }
}
