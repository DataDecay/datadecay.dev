const { ticalc, tifiles } = window["ticalc-usb"];
import { presets, allApps } from './presets.js'; // ensure your environment supports ES modules
let calculator = null;
let preset = null;


// Error handlers
window.onerror = function (message, source, lineno, colno, err) {
    alert(`Error: ${message}\nSource: ${source}\nLine: ${lineno}, Column: ${colno}\nDetails: ${err ? err.stack : 'N/A'}`);
    return false;
};
window.addEventListener('unhandledrejection', function (event) {
    alert(`Unhandled promise rejection: ${event.reason ? event.reason.stack || event.reason : 'Unknown error'}`);
});

// UI elements
const appCheckboxesDiv = document.getElementById('appCheckboxes');
const presetSelect = document.querySelector('#presetSelect');

window.addEventListener('load', async () => {
    if (ticalc.browserSupported()) {
        showSupportedDevices();
        attachConnectionListeners();
        attachClickListeners();
        populatePresets();
        try {
            await ticalc.init({ supportLevel: 'none' });
        } catch (e) {
            handleUnsupported(e);
        }
        updateButtons();
        document.querySelector('#flow').style.display = 'block';
        document.querySelector('#incompatible').style.display = 'none';
    } else {
        document.querySelector('#flow').style.display = 'none';
        document.querySelector('#incompatible').style.display = 'block';
    }
});

function showSupportedDevices() {
    const calcNames = ticalc.models()
        .filter(c => c.status === 'supported' || c.status === 'beta')
        .map(c => c.status === 'beta' ? c.name + ' (beta)' : c.name)
        .join(', ');
    document.querySelector('#supported').innerText = calcNames || "None";
}

function updateButtons() {
    document.querySelector('#connect').disabled = !!calculator;
    presetSelect.disabled = !calculator;
    document.querySelector('#start').disabled = !(calculator && preset && (preset !== 'CUSTOM' || hasCheckedApps()));
}

function attachConnectionListeners() {
    ticalc.addEventListener('disconnect', calc => {
        if (calc !== calculator) return;
        calculator = null;
        alertPopup("Disconnected", "Calculator disconnected.");
        updateButtons();
    });
    ticalc.addEventListener('connect', async calc => {
        if (calc.status === 'experimental') {
            confirmPopup('Be careful!', `Your device (${calc.name}) only has ${calc.status} support. Continue?`)
                .then(() => connect(calc))
                .catch(() => { });
        } else {
            await connect(calc);
        }
    });
}

async function connect(calc) {
    try {
        if (await calc.isReady()) {
            calculator = calc;
            alertPopup('Connected', `Connected to ${calculator.name}.`);
            updateButtons();
        } else {
            alertPopup('Error', 'The connected device is not responding.');
        }
    } catch (e) {
        alertPopup('Connection Error', 'Failed to connect to device.');
        console.error(e);
    }
}

function attachClickListeners() {
    document.querySelector('#connect').addEventListener('click', async () => {
        try {
            await ticalc.choose();
        } catch (e) {
            handleUnsupported(e);
        }
    });

    presetSelect.addEventListener('change', e => {
        const idx = e.target.value;
        if (idx === 'CUSTOM') {
            preset = 'CUSTOM';
            renderAppCheckboxes();
            appCheckboxesDiv.style.display = 'block';
        } else {
            preset = idx !== "" ? presets[idx] : null;
            appCheckboxesDiv.style.display = 'none';
            appCheckboxesDiv.innerHTML = '';
        }
        updateButtons();
    });

    document.querySelector("#appCheckbox").addEventListener('click', () => {
        updateButtons();
    })

    document.querySelector('#start').addEventListener('click', async () => {
        if (!calculator || !preset) return;

        let filesToSend = [];

        if (preset === 'CUSTOM') {
            // Gather checked apps
            const selectedApps = Array.from(document.querySelectorAll('input[name="appCheckbox"]:checked')).map(cb => cb.value);
            if (selectedApps.length === 0) {
                await alertPopup('Custom preset', 'Please select at least one app.');
                return;
            }
            for (const appId of selectedApps) {
                try {
                    const listResponse = await fetch(`./apps/${appId}/files.json`);
                    if (!listResponse.ok) {
                        await alertPopup('Error', `Failed to load file list for app: ${appId}`);
                        return;
                    }
                    const fileList = await listResponse.json();
                    filesToSend.push(...fileList.map(name => `./apps/${appId}/${name}`));
                } catch (e) {
                    await alertPopup('Error', `Failed to fetch file list for app '${appId}':\n${e.message}`);
                    return;
                }
            }
        } else {
            // Normal preset files/apps
            if (preset.files) filesToSend.push(...preset.files);
            if (preset.apps) {
                for (const appId of preset.apps) {
                    try {
                        const listResponse = await fetch(`./apps/${appId}/files.json`);
                        if (!listResponse.ok) {
                            await alertPopup('Error', `Failed to load file list for app: ${appId}`);
                            return;
                        }
                        const fileList = await listResponse.json();
                        filesToSend.push(...fileList.map(name => `./apps/${appId}/${name}`));
                    } catch (e) {
                        await alertPopup('Error', `Failed to fetch file list for app '${appId}':\n${e.message}`);
                        return;
                    }
                }
            }
        }

        const progressContainer = document.getElementById('progressContainer');
        const progressBar = document.getElementById('progressBar');
        const progressText = document.getElementById('progressText');
        progressContainer.style.display = 'block';
        progressBar.value = 0;
        progressText.textContent = '0%';

        const totalFiles = filesToSend.length;

        for (let i = 0; i < totalFiles; i++) {
            const url = filesToSend[i];
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    await alertPopup('Download Error', `Failed to download file: ${url}`);
                    return;
                }
                const buffer = await response.arrayBuffer();
                const file = tifiles.parseFile(new Uint8Array(buffer));
                if (!tifiles.isValid(file)) {
                    await alertPopup('Invalid File', `Invalid calculator file: ${url}`);
                    return;
                }
                if (!calculator.canReceive(file)) {
                    await alertPopup('File Error', `File not valid for ${calculator.name}: ${url}`);
                    return;
                }
                const details = await calculator.getStorageDetails(file);
                if (!details.fits) {
                    await alertPopup('Memory Error', `Not enough memory on calculator for file: ${url}`);
                    return;
                }
                await calculator.sendFile(file);
                const percent = Math.round(((i + 1) / totalFiles) * 100);
                progressBar.value = percent;
                progressText.textContent = `${percent}% (${i + 1} of ${totalFiles}) sent. (${url})`;
            } catch (error) {
                await alertPopup('Send Error', `Failed to send file: ${url}\n${error.message}`);
                return;
            }
        }

        progressContainer.style.display = 'none';
        document.querySelector('#start').disabled = true;
        await alertPopup('Next Steps', preset === 'CUSTOM' ? 'Custom apps sent.' : preset.info);
    });
}

function populatePresets() {
    presets.forEach((p, i) => {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = p.name;
        presetSelect.appendChild(option);
    });
    // Append custom option
    const customOption = document.createElement('option');
    customOption.value = 'CUSTOM';
    customOption.textContent = 'Custom';
    presetSelect.appendChild(customOption);
}

function renderAppCheckboxes() {
    appCheckboxesDiv.innerHTML = ''; // Clear prior
    allApps.forEach(app => {
        const label = document.createElement('label');
        label.style.display = 'block';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = app.id;
        checkbox.name = 'appCheckbox';
        checkbox.class = 'appCheckbox'
        label.appendChild(checkbox);
        label.appendChild(document.createTextNode(' ' + app.name));
        appCheckboxesDiv.appendChild(label);
    });
}

function hasCheckedApps() {
    return document.querySelectorAll('input[name="appCheckbox"]:checked').length > 0;
}

function handleUnsupported(error) {
    console.error(error);
    alertPopup('Unsupported', error.message || 'Your calculator may not be supported yet.');
}

/* Popup system */
function setPopup(title, body) {
    const popup = document.getElementById('popup');
    popup.querySelector('h2').innerText = title;
    popup.querySelector('p').innerText = body;
    popup.querySelector('.buttons').innerHTML = '';
    popup.style.display = 'block';
    return popup;
}

function popupButton(clss, text, fn) {
    const button = document.createElement('button');
    button.classList.add(clss);
    button.innerText = text;
    button.onclick = fn;
    return button;
}

function alertPopup(title, body) {
    return new Promise(resolve => {
        const popup = setPopup(title, body);
        const button = popupButton('yes', 'Okay', () => {
            popup.style.display = 'none';
            resolve();
        });
        popup.querySelector('.buttons').appendChild(button);
    });
}

function confirmPopup(title, body) {
    return new Promise((resolve, reject) => {
        const popup = setPopup(title, body);
        const yesButton = popupButton('yes', 'Okay', () => {
            popup.style.display = 'none';
            resolve();
        });
        const noButton = popupButton('no', 'Cancel', () => {
            popup.style.display = 'none';
            reject();
        });
        popup.querySelector('.buttons').appendChild(yesButton);
        popup.querySelector('.buttons').appendChild(noButton);
    });
}
