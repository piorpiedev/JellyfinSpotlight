// Create an iframe and inject the Spotlight HTML/CSS
(async function() {
    const htmlUrl = "https://raw.githubusercontent.com/piorpiedev/JellyfinSpotlight/refs/heads/main/spotlight.html";

    // Helper to Wait for the Home Library section to load
    const waitForElement = (selector) => {
        return new Promise(resolve => {
            if (document.querySelector(selector)) return resolve(document.querySelector(selector));
            const observer = new MutationObserver(() => {
                if (document.querySelector(selector)) {
                    observer.disconnect();
                    resolve(document.querySelector(selector));
                }
            });
            // Observe body for changes until our target appears
            observer.observe(document.body, { childList: true, subtree: true });
        });
    };

    const checkAndInject = async () => {
        // Check if should inject
        const isHomePage = window.location.href.includes("home") || window.location.href.endsWith("/web/index.html");
        if (!isHomePage) return;
        const targetSection = await waitForElement(".section0"); // "section0" is usually the "My Media" library row
        if (document.getElementById("spotlight-iframe")) return; // Prevent duplicate injection
        console.log("Spotlight: Injecting Interface...");

        // Create the Iframe
        const iframe = document.createElement("iframe");
        iframe.id = "spotlight-iframe";
        iframe.className = "spotlightiframe";
        iframe.tabIndex = 0;
        
        // Position the iframe in the dashboard
        iframe.style.cssText = `
            width: 99.5vw;
            height: 63vh;
            display: block;
            border: 0;
            margin: -10px auto -30px auto; 
            overflow: hidden;
        `;

        // Insert iframe BEFORE the library list
        targetSection.parentNode.insertBefore(iframe, targetSection);

        // Fetch and Write Content
        try {
            const htmlRes = await Promise.resolve(fetch(htmlUrl));
            if (!htmlRes.ok) throw new Error("Failed to load Spotlight files");
            let htmlContent = await htmlRes.text();

            // Write to the Iframe (Same-Origin)
            // Writing to "about:blank" allows the iframe to access window.parent (your Jellyfin Auth)
            const doc = iframe.contentWindow.document;
            doc.open();
            doc.write(htmlContent);
            doc.close();
            console.log("Spotlight: Injection Complete");

        } catch (error) {
            console.error("Spotlight: Error loading plugin", error);
            iframe.remove(); 
        }
    };

    // Run immediately and listen for navigation (Jellyfin is a Single Page App)
    checkAndInject();
    
    // Re-run when internal navigation occurs
    const pushState = history.pushState;
    history.pushState = function () {
        pushState.apply(history, arguments);
        setTimeout(checkAndInject, 500); // Small delay to let DOM settle
    };
    window.addEventListener("popstate", () => setTimeout(checkAndInject, 500));
})();
