// Initialize global variables
let customTitle = '';
let moviesSeriesBoth = 3, shuffleInterval = 10000, plotMaxLength = 600, useTrailers = true;
let isChangingSlide = false, player = null, slideChangeTimeout = null, isHomePageActive = false, navigationInterval = null;
let currentLocation = window.top.location.href;
let movieList = [], currentMovieIndex = 0, lastMovie = null, currentMovie = null, currentSlideElement = null;
let localTrailerIframe = null;
let globalVolume = Number(localStorage.getItem('spotlightVolume') ?? 0.5);

let historyList = [];       // Stores movie objects
let historyIndex = -1;      // Points to current movie in history
let preloadedMovie = null;
let preloadedImage = null;
let isHovering = false;
let isFetching = false;
let trailerHoverTimeout = null;

// Get User Auth token
const getJellyfinAuth = () => {
    let token = null;
    let userId = null;
    const initEl = window.parent.document.getElementById('jellyfin-initialization-data');
    if (initEl) {
        try {
            const initJson = JSON.parse(initEl.textContent);
            token = initJson?.AccessToken;
            userId = initJson?.User?.Id;
        } catch { }
    }
    if (!token) {
        try {
            const raw = window.parent.localStorage.getItem('jellyfin_credentials');
            if (raw) {
                const creds = JSON.parse(raw);
                token = creds?.Servers?.[0]?.AccessToken;
                userId = creds?.Servers?.[0]?.UserId;
            }
        } catch { }
    }
    if (!token) {
        const v = window.parent.document.querySelector('video');
        const s = v?.currentSrc || v?.src || '';
        token = s.match(/[?&]api_key=([^&]+)/i)?.[1] || null;
    }
    return { token, userId };
};

const { token, userId: fallbackUserId } = getJellyfinAuth();

// Create and return a new DOM element with specified attributes
const createElem = (tag, className, textContent, src, alt) => {
    const elem = document.createElement(tag);
    if (className) elem.className = className;
    if (textContent) elem.textContent = textContent;
    if (src) elem.src = src;
    if (alt) elem.alt = alt;
    return elem;
};

// Truncate text to a specified maximum length and append '...' if truncated
const truncateText = (text, maxLength) => text && text.length > maxLength ? text.substr(0, maxLength) + '...' : text;

// Display error messages to users
const displayError = (message) => {
    const errorDiv = createElem('div', 'error-message');
    errorDiv.textContent = message;
    document.body.appendChild(errorDiv);
    setTimeout(() => {
        if (errorDiv.parentNode) errorDiv.parentNode.removeChild(errorDiv);
    }, 5000); // Remove after 5 seconds
};

// Clean up existing player and timeout
const cleanup = () => {
    if (player && typeof player.stopVideo === 'function') {
        player.stopVideo();
        player.destroy();
        player = null;
        console.log("YouTube player cleaned up.");
    }
    if (localTrailerIframe) {
        localTrailerIframe.remove();
        localTrailerIframe = null;
        console.log("Local trailer iframe removed.");
    }
    document.querySelectorAll(".video-container").forEach(e => e.remove())
    if (slideChangeTimeout) {
        clearTimeout(slideChangeTimeout);
        slideChangeTimeout = null;
        console.log("Slide change timeout cleared.");
    }
    if (trailerHoverTimeout) {
        clearTimeout(trailerHoverTimeout);
        trailerHoverTimeout = null;
        console.log("Slide change timeout cleared.");
    }

    const txt = document.querySelector('.text-container');
    if (txt) txt.classList.remove('fade-out');
};

// Shut down the slideshow by cleaning up and resetting variables
const shutdown = () => {
    isChangingSlide = true;
    cleanup();
    document.getElementById('rightButton').onclick = null;
    document.getElementById('leftButton').onclick = null;
    const container = document.getElementById('slides-container');
    if (container) container.innerHTML = '';
    currentMovie = null;
    lastMovie = null;
    currentMovieIndex = 0;
    movieList = [];
    isHomePageActive = false;
    isChangingSlide = false;

    console.log("Slideshow has been completely shutdown");
};

const updateVolumeButtonVisibility = (show) => {
    const btn = document.getElementById('volumeButton');
    if (btn) {
        if (show) btn.classList.add('visible');
        else btn.classList.remove('visible');
    }
};

// Update the state of navigation buttons based on the current and last movie
const updateSlideButtons = () => {
    const leftBtn = document.getElementById('leftButton');
    if (leftBtn) {
        const canGoBack = historyIndex > 0;
        leftBtn.disabled = !canGoBack; // actually set property
        leftBtn.removeAttribute('disabled'); // ensure DOM attribute is gone
        
        leftBtn.style.opacity = canGoBack ? '1' : '0.3';
        leftBtn.style.cursor = canGoBack ? 'pointer' : 'default';
        leftBtn.style.pointerEvents = canGoBack ? 'auto' : 'none';
    }
};

// Check if backdrop and logo images exist for the movie, then create the slide or fetch the next movie
const checkBackdropAndLogo = movie => {
    Promise.all(['/Images/Backdrop/0', '/Images/Logo'].map(url =>
        fetch(`/Items/${movie.Id}${url}`, { method: 'HEAD' }).then(response => response.ok)
    )).then(([backdropExists, logoExists]) => {
        if (backdropExists && logoExists) {
            console.log(`Backdrop and logo exist for movie: ${movie.Name}`);
            createSlideElement(movie, true);
        } else {
            console.log(`Backdrop or logo missing for movie: ${movie.Name}. Fetching next movie.`);
            fetchNextMovie();
        }
    }).catch(error => {
        console.error("Error checking backdrop and logo:", error);
        fetchNextMovie();
    });
};

async function checkLocalTrailer(itemId) {
    const uid = fallbackUserId; // already from getJellyfinAuth()
    if (!token || !uid) return null;

    try {
        const res = await fetch(`/Users/${uid}/Items/${itemId}/LocalTrailers?api_key=${token}`);
        if (!res.ok) return null;
        const arr = await res.json();
        if (!arr?.length) return null;

        const t = arr[0];
        const mediaSourceId = t.MediaSources?.[0]?.Id;
        const streamUrl = mediaSourceId
            ? `/Videos/${t.Id}/stream.mp4?Static=true&mediaSourceId=${mediaSourceId}&api_key=${token}`
            : null;

        return { trailer: t, streamUrl };
    } catch (e) {
        console.warn("Local trailer check failed:", e);
        return null;
    }
}

// Create and display a new slide element for the given movie
const createSlideElement = async (movie) => {
    cleanup(); // Clean previous iframe
    
    // Note: We do NOT reset isHovering here. 
    // If the mouse is already there (e.g. clicked Next), we stay hovering.
    
    updateVolumeButtonVisibility(false);
    if (trailerHoverTimeout) clearTimeout(trailerHoverTimeout);

    const container = document.getElementById('slides-container');
    const newSlide = createElem('div', 'slide');

    // 1. Visuals
    const visualWrapper = createElem('div', 'visual-wrapper');
    const backdropImg = createElem('img', 'backdrop', null, `/Items/${movie.Id}/Images/Backdrop/0`, 'backdrop');
    visualWrapper.appendChild(backdropImg);
    newSlide.appendChild(visualWrapper);

    // 2. Rating & Metadata
    const getCleanRating = (r) => {
        if (!r) return null;
        r = r.toUpperCase();
        if (['TV-MA', 'NC-17', 'R', '18', 'VM18'].some(x => r.includes(x))) return '18+';
        if (['16', 'VM16'].some(x => r.includes(x))) return '16+';
        if (['PG-13', 'TV-14', '14', 'VM14'].some(x => r.includes(x))) return '14+';
        if (['PG', 'TV-PG', '12', '10'].some(x => r.includes(x))) return '12+';
        return null;
    };
    const cleanRating = getCleanRating(movie.OfficialRating);
    if (cleanRating) {
        const ratingBox = createElem('div', 'age-rating-box');
        ratingBox.textContent = cleanRating;
        newSlide.appendChild(ratingBox);
    }

    const textContainer = createElem('div', 'text-container');
    const logoImg = new Image();
    logoImg.src = `/Items/${movie.Id}/Images/Logo`;
    logoImg.onload = () => textContainer.prepend(createElem('img', 'logo', null, logoImg.src, 'logo'));
    logoImg.onerror = () => {
        const titleEl = document.createElement('h1');
        titleEl.className = 'title-text';
        titleEl.textContent = movie.Name;
        textContainer.prepend(titleEl);
    };

    const year = movie.PremiereDate ? new Date(movie.PremiereDate).getFullYear() : '';
    const genres = movie.Genres ? movie.Genres.slice(0, 2).join(', ') : '';
    const duration = movie.RunTimeTicks ? Math.round(movie.RunTimeTicks / 600000000) + 'm' : '';
    const commRating = movie.CommunityRating ? movie.CommunityRating.toFixed(1) : '';

    let metaHTML = ``;
    if (commRating) metaHTML += `<span class="star-rating"><span class="material-icons">star</span> ${commRating}</span>`;
    if (year) metaHTML += `<span>${year}</span>`;
    if (duration) metaHTML += `<span>${duration}</span>`;
    if (genres) metaHTML += `<span>${genres}</span>`;

    const loremDiv = createElem('div', 'lorem-ipsum');
    loremDiv.innerHTML = metaHTML;
    textContainer.appendChild(loremDiv);
    textContainer.appendChild(createElem('div', 'plot', truncateText(movie.Overview, plotMaxLength)));

    const btnContainer = createElem('div', 'hero-buttons');
    const playBtn = createElem('button', 'btn-hero btn-play');
    playBtn.innerHTML = '<span class="material-icons">play_arrow</span> Play';
    playBtn.onclick = (e) => { 
        e.stopPropagation();
        if (window.top.require) {
            window.top.require(['playbackManager'], (pm) => pm.play({ ids: [movie.Id] }));
        } else if (window.top.Emby && window.top.Emby.PlaybackManager) {
            window.top.Emby.PlaybackManager.play({ ids: [movie.Id] });
        } else {
            window.top.Emby.Page.showItem(movie.Id);
        }
    };
    const infoBtn = createElem('button', 'btn-hero btn-info');
    infoBtn.innerHTML = '<span class="material-icons">info_outline</span> More Info';
    infoBtn.onclick = (e) => { e.stopPropagation(); window.top.Emby.Page.showItem(movie.Id); };
    
    btnContainer.appendChild(playBtn);
    btnContainer.appendChild(infoBtn);
    textContainer.appendChild(btnContainer);
    newSlide.appendChild(textContainer);

    // 3. Define Trailer Logic (But don't attach listeners to Slide anymore)
    const startTrailer = async () => {
        if (!useTrailers) return;
        
        // Wait for async check, then verify hover again
        const localData = await checkLocalTrailer(movie.Id);
        if (!isHovering) return; 
        if (newSlide.querySelector('.video-container')) return;

        const videoContainer = createElem('div', 'video-container');
        const clickOverlay = createElem('div', 'video-click-overlay');
        Object.assign(clickOverlay.style, { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 999, cursor: 'pointer', background: 'transparent' });
        videoContainer.appendChild(clickOverlay);

        let videoAdded = false;

        if (localData) {
            const { trailer, streamUrl } = localData;
            const iframe = document.createElement('iframe');
            iframe.className = 'local-trailer-frame';
            iframe.allow = 'autoplay';
            iframe.style.border = '0';
            iframe.srcdoc = `
                <style>body{margin:0;background:#000;overflow:hidden;}video{width:100%;height:100%;object-fit:cover;}</style>
                <video id="v" autoplay src="${streamUrl}"></video>
                <script>
                    const v=document.getElementById('v');
                    v.volume=${globalVolume};
                    v.onended = () => parent.postMessage('local-trailer-ended', '*');
                    window.addEventListener('message', e => { if(e.data==='toggle') v.paused?v.play():v.pause(); });
                <\/script>`;
            videoContainer.appendChild(iframe);
            localTrailerIframe = iframe;
            clickOverlay.onclick = () => iframe.contentWindow.postMessage('toggle', '*');
            videoAdded = true;
        } else if (movie.RemoteTrailers?.length > 0 && window.YT) {
            const trailerUrl = movie.RemoteTrailers[0].Url;
            const videoId = trailerUrl.match(/[?&]v=([^&]+)/)?.[1];
            if (videoId) {
                const vidDiv = createElem('div', 'video-player');
                videoContainer.appendChild(vidDiv);

                player = new YT.Player(vidDiv, {
                    height: '100%', width: '100%', videoId: videoId,
                    playerVars: { 'autoplay': 1, 'controls': 0, 'modestbranding': 1, 'rel': 0, 'iv_load_policy': 3, 'disablekb': 1, 'fs': 0, 'playsinline': 1 },
                    events: {
                        'onReady': (e) => {
                            if(!isHovering) { cleanup(); return; }
                            e.target.setVolume(globalVolume * 100);
                            backdropImg.style.opacity = '0';
                            updateVolumeButtonVisibility(true);
                            const txt = newSlide.querySelector('.text-container');
                            if(txt) txt.classList.add('fade-out');
                        },
                        'onStateChange': (e) => {
                            if (e.data === YT.PlayerState.ENDED) { backdropImg.style.opacity = '1'; cleanup(); }
                        }
                    }
                });
                clickOverlay.onclick = () => player.getPlayerState() === 1 ? player.pauseVideo() : player.playVideo();
                videoAdded = true;
            }
        }

        if (videoAdded) {
            newSlide.appendChild(videoContainer);
            if (localData) {
                 setTimeout(() => { 
                     if(isHovering) {
                         backdropImg.style.opacity = '0';
                         updateVolumeButtonVisibility(true);

                         const txt = newSlide.querySelector('.text-container');
                         if(txt) txt.classList.add('fade-out');
                     }
                 }, 500);
            }
        }
    };

    // Update the global reference to the current trailer starter
    currentTrailerStarter = startTrailer;

    // Check immediately if we are already hovering (e.g. user clicked Next)
    if (isHovering) {
        trailerHoverTimeout = setTimeout(() => {
            if (isHovering && currentTrailerStarter) currentTrailerStarter();
        }, 300);
    }

    // Mount Slide
    if (window.currentSlideElement) {
        const old = window.currentSlideElement;
        old.classList.remove('visible');
        setTimeout(() => old.remove(), 1300);
    }
    
    container.appendChild(newSlide);
    void newSlide.offsetWidth;
    newSlide.classList.add('visible');
    
    window.currentSlideElement = newSlide;
    window.currentMovie = movie;
    updateSlideButtons();
};

// Read a custom list of movie IDs from 'list.txt' and update the title
const readCustomList = () =>
    fetch('list.txt?' + new Date().getTime())
        .then(response => response.ok ? response.text() : null)
        .then(text => {
            if (!text) return null;
            const lines = text.split('\n').filter(Boolean);
            customTitle = lines.shift() || customTitle;
            // Not Using list titles for now    document.getElementById('titleHeading').textContent = customTitle;
            return lines.map(line => line.trim().substring(0, 32));
        })
        .catch(error => {
            console.error("Error reading custom list:", error);
            return null;
        });

// Fetch a random movie or the next movie in the custom list
const fetchRandomMovie = () => {
    if (isChangingSlide) {
        console.log("Slide change already in progress.");
        return;
    }
    isChangingSlide = true;

    if (movieList.length === 0) {
        readCustomList().then(list => {
            if (list) {
                movieList = list;
                currentMovieIndex = 0;
                console.log("Custom movie list loaded:", movieList);
            }
            fetchNextMovie();
        }).catch(error => {
            console.error("Error loading custom movie list:", error);
            fetchNextMovie();
        });
    } else {
        fetchNextMovie();
    }
};

const fetchNextMovie = () => {
    if (isFetching) return; // Block double-clicks or race conditions
    isFetching = true;

    // 1. History Navigation
    if (historyIndex < historyList.length - 1) {
        historyIndex++;
        console.log("History Forward to index:", historyIndex);
        createSlideElement(historyList[historyIndex]);
        isFetching = false;
        return;
    }

    // 2. Buffer Navigation
    if (preloadedMovie) {
        addToHistory(preloadedMovie);
        createSlideElement(preloadedMovie);
        
        preloadedMovie = null;
        preloadedImage = null;
        isFetching = false;
        
        preloadNextMovie(); // Start buffering next
        return;
    }

    // 3. Cold Fetch
    const uid = fallbackUserId;
    const itemTypes = moviesSeriesBoth === 1 ? 'Movie' : (moviesSeriesBoth === 2 ? 'Series' : 'Movie,Series');
    
    fetch(`/Users/${uid}/Items?IncludeItemTypes=${itemTypes}&Recursive=true&Limit=1&SortBy=random&Fields=Id,Overview,RemoteTrailers,PremiereDate,RunTimeTicks,ChildCount,Title,Type,Genres,OfficialRating,CommunityRating&api_key=${token}`)
        .then(r => r.json())
        .then(d => { 
            if (d.Items?.[0]) {
                const mov = d.Items[0];
                addToHistory(mov);
                createSlideElement(mov);
            }
            isFetching = false;
            preloadNextMovie(); 
        })
        .catch(e => {
            console.error("Fetch failed:", e);
            isFetching = false;
        });
};

const navigatePrevious = () => {
    if (historyIndex > 0) {
        historyIndex--;
        console.log("History Back to index:", historyIndex);
        createSlideElement(historyList[historyIndex]);
    }
};

// New Function: Fetch a movie silently in the background
const preloadNextMovie = () => {
    const uid = fallbackUserId;
    if (!token || !uid) return;
    const itemTypes = moviesSeriesBoth === 1 ? 'Movie' : (moviesSeriesBoth === 2 ? 'Series' : 'Movie,Series');
    
    // Fetch 1 random item
    fetch(`/Users/${uid}/Items?IncludeItemTypes=${itemTypes}&Recursive=true&Limit=1&SortBy=random&Fields=Id,Overview,RemoteTrailers,PremiereDate,RunTimeTicks,ChildCount,Title,Type,Genres,OfficialRating,CommunityRating&api_key=${token}`)
        .then(r => r.json())
        .then(data => {
            if (data.Items?.[0]) {
                const mov = data.Items[0];
                // Check Backdrop existence
                const img = new Image();
                img.onload = () => {
                    preloadedMovie = mov;
                    preloadedImage = img; // Keep ref so garbage collector doesn't kill it
                    console.log("Buffered:", mov.Name);
                };
                img.onerror = () => {
                    console.log("Bad backdrop, skipping:", mov.Name);
                    preloadNextMovie(); // Retry immediately
                };
                img.src = `/Items/${mov.Id}/Images/Backdrop/0`;
            }
        });
};

const addToHistory = (movie) => {
    historyList.push(movie);
    historyIndex = historyList.length - 1;

    // Limit to 30
    if (historyList.length > 30) {
        historyList.shift();
        historyIndex--; 
    }
};


// Start a timer to change slides after a specified interval
const startSlideChangeTimer = () => {
    if (slideChangeTimeout) clearTimeout(slideChangeTimeout);
    slideChangeTimeout = setTimeout(fetchNextMovie, shuffleInterval);
    console.log("Slide change timer started.");
};

// Check if the user has navigated away from the homepage and handle slideshow accordingly
const checkNavigation = () => {
    const newLocation = window.top.location.href;

    if (newLocation !== currentLocation) {
        currentLocation = newLocation;
        const isHomePage = url => url.includes("/web/#/home.html") ||
            url.includes("/web/#/home") ||
            url.includes("/web/index.html#/home.html") ||
            url === "/web/index.html#/home" ||
            url.endsWith("/web/");

        if (isHomePage(newLocation)) {
            if (!isHomePageActive) {
                console.log("Returning to homepage, reactivating slideshow");
                isHomePageActive = true;
                cleanup();
                fetchRandomMovie();
                attachButtonListeners();
            }
        } else if (isHomePageActive) {
            console.log("Leaving homepage, shutting down slideshow");
            shutdown();
            // setTimeout(function () {
            //     window.location.href = window.location.href;
            //     cleanup();
            //     /* This page reload is strangely critical to ensure
            //     we don't double the script vars upon navigating home
            //     using Jellyfin's home button. But it makes videos only
            //     load on home not navback. Meh, lesser of two evils;
            //     True SPA headache... */
            // }, 500);
        }
    }
};

// Attach event listeners to navigation buttons
const attachButtonListeners = () => {
    const rightButton = document.getElementById('rightButton');
    const leftButton = document.getElementById('leftButton');

    if (rightButton && leftButton) {
        rightButton.onclick = fetchNextMovie;
        leftButton.onclick = navigatePrevious;
        fetchNextMovie();
        setTimeout(preloadNextMovie, 2000);
        console.log("Navigation button listeners attached.");
    }

    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowRight') fetchNextMovie();
        if (e.key === 'ArrowLeft') navigatePrevious();
    });

    document.body.addEventListener('mouseenter', () => {
        isHovering = true;
        if (trailerHoverTimeout) clearTimeout(trailerHoverTimeout);
        trailerHoverTimeout = setTimeout(() => {
            if (isHovering && currentTrailerStarter) currentTrailerStarter();
        }, 300);
    });

    document.body.addEventListener('mousemove', () => {
        // Fallback: sometimes iframe mouseenter is finicky
        if (!isHovering) {
            isHovering = true;
            if (trailerHoverTimeout) clearTimeout(trailerHoverTimeout);
            trailerHoverTimeout = setTimeout(() => {
                if (isHovering && currentTrailerStarter) currentTrailerStarter();
            }, 300);
        }
    });

    document.body.addEventListener('mouseleave', () => {
        isHovering = false;
        if (trailerHoverTimeout) clearTimeout(trailerHoverTimeout);
        cleanup(); // Stop trailer
        updateVolumeButtonVisibility(false);
        // Show backdrop again
        const backdrop = document.querySelector('.backdrop');
        if (backdrop) backdrop.style.opacity = '1';
    });
};

function initVolumeControl() {
    const button = document.getElementById('volumeButton');
    const icon = button.querySelector('.material-icons');
    const slider = document.getElementById('volumeSlider');

    let muted = globalVolume === 0;

    // 🔹 Initialize slider and icon state from globalVolume
    slider.value = globalVolume * 100;
    icon.textContent = muted ? 'volume_off' : 'volume_up';

    // Toggle mute on click (ignore clicks on slider itself)
    button.addEventListener('click', e => {
        if (e.target === slider) return;
        muted = !muted;
        slider.value = muted ? 0 : globalVolume * 100 || 50; // fallback to 50 if unset
        updateVolume(parseInt(slider.value, 10));
        icon.textContent = muted ? 'volume_off' : 'volume_up';
    });

    // Adjust volume on slider input
    slider.addEventListener('input', () => {
        const vol = parseInt(slider.value, 10);
        muted = vol === 0;
        icon.textContent = muted ? 'volume_off' : 'volume_up';
        updateVolume(vol);
    });

    function updateVolume(vol) {
        globalVolume = vol / 100; // persist globally
        localStorage.setItem('spotlightVolume', String(globalVolume));

        // YouTube trailers
        if (player?.setVolume) player.setVolume(vol);

        // Local trailers
        if (localTrailerIframe?.contentWindow) {
            localTrailerIframe.contentWindow.postMessage(
                { type: 'setVolume', value: globalVolume }, '*'
            );
        }
    }
}

// Initialize the slideshow once the DOM is fully loaded
document.addEventListener('DOMContentLoaded', () => {
    if (window.innerWidth < 701) useTrailers = false;
    const isHomePage = url => url.includes('/home') || url.endsWith('/web/') || url.endsWith('/web/index.html');
    if (isHomePage(window.top.location.href)) {
        isHomePageActive = true;
        cleanup();
        fetchRandomMovie();
        attachButtonListeners();
        initVolumeControl();
        console.log("Slideshow initialized on homepage.");
    }
    navigationInterval = setInterval(checkNavigation, 250);
    console.log("Navigation check interval started.");
}, { passive: true });

// Expose controlYouTubePlayer to the global window scope
window.controlYouTubePlayer = {
    // Toggle play/pause state of the YouTube player
    toggle: function () {
        if (player && typeof player.getPlayerState === 'function') {
            const state = player.getPlayerState();
            if (state === YT.PlayerState.PLAYING) {
                player.pauseVideo();
                console.log("YouTube player paused.");
            } else {
                player.playVideo();
                console.log("YouTube player playing.");
            }
        } else {
            console.warn('YouTube player is not initialized or not available.');
        }
    }
};