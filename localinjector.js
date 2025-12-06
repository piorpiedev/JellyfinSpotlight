const fs = require('fs');
const path = require('path');

async function buildAndCopy() {
    try {
        // Importazione dinamica per clipboardy (compatibilità ES Module)
        const { default: clipboardy } = await import('clipboardy');

        console.log("📂 Lettura dei file locali...");

        const basePath = __dirname;
        const htmlPath = path.join(basePath, 'spotlight.html');
        const cssPath = path.join(basePath, 'spotlight.css');
        const jsHeadPath = path.join(basePath, 'spotlight-head.js');
        const jsBodyPath = path.join(basePath, 'spotlight-body.js');

        // Controllo esistenza file
        if (!fs.existsSync(htmlPath)) throw new Error("Manca spotlight.html");

        let htmlContent = fs.readFileSync(htmlPath, 'utf8');
        const cssContent = fs.readFileSync(cssPath, 'utf8');
        const jsHeadContent = fs.readFileSync(jsHeadPath, 'utf8');
        const jsBodyContent = fs.readFileSync(jsBodyPath, 'utf8');

        console.log("🔨 Assemblaggio del codice...");

        // Iniezione contenuti nei placeholder
        htmlContent = htmlContent.replace(
            `<script src="spotlight-head.js"></script>`,
            `<script>${jsHeadContent}</script>`
        );
        htmlContent = htmlContent.replace(
            `<script src="spotlight-body.js"></script>`,
            `<script>${jsBodyContent}</script>`
        );
        htmlContent = htmlContent.replace(
            `<link rel="stylesheet" href="spotlight.css">`,
            `<style>${cssContent}</style>`
        );

        // --- PUNTO CRUCIALE: Codifica in Base64 ---
        // Questo trasforma tutto l'HTML in una stringa sicura senza caratteri speciali
        const base64Content = Buffer.from(htmlContent).toString('base64');

        // Creazione dello script di iniezione
        // Nota: Lato browser usiamo atob() e decodeURIComponent per decodificare
        const finalInjectionScript = `
(async function() {
    const waitForElement = (selector) => {
        return new Promise(resolve => {
            if (document.querySelector(selector)) return resolve(document.querySelector(selector));
            const observer = new MutationObserver(() => {
                if (document.querySelector(selector)) {
                    observer.disconnect();
                    resolve(document.querySelector(selector));
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
        });
    };

    const targetSection = await waitForElement(".section0");
    if (document.getElementById("spotlight-iframe")) {
        console.log("Spotlight già presente.");
        return;
    }
    
    console.log("Spotlight: Injecting Local Build via Base64...");
    
    const iframe = document.createElement("iframe");
    iframe.id = "spotlight-iframe";
    iframe.className = "spotlightiframe";
    iframe.tabIndex = 0;
    iframe.style.cssText = "width: 100%; min-height: 75vh; aspect-ratio: 7/4; display: block; border: 0; margin: -8.5em auto -55px auto; overflow: hidden;";
    
    targetSection.parentNode.insertBefore(iframe, targetSection);
    
    // Decodifica del contenuto Base64
    // Usiamo decodeURIComponent(escape(atob(...))) per gestire correttamente i caratteri speciali/UTF-8
    const content = decodeURIComponent(escape(window.atob("${base64Content}")));

    const doc = iframe.contentWindow.document;
    doc.open();
    doc.write(content); 
    doc.close();
    console.log("Spotlight: Iniezione completata.");
})();
`;

        await clipboardy.write(finalInjectionScript);
        
        console.log("✅ Successo! Script copiato nella clipboard.");
        console.log("👉 Ora vai sulla console del browser e premi CTRL+V");

    } catch (error) {
        console.error("❌ Errore:", error);
    }
}

buildAndCopy();