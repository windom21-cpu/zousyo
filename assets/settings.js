import { getPAT, setPAT, getNick, setNick, config } from './core.js?v=1.1';
import QRCode from 'https://esm.sh/qrcode@1.5.3';

const $ = id => document.getElementById(id);

$('cfgOwner').textContent = config.owner;
$('cfgRepo').textContent = config.repo;
$('cfgBranch').textContent = config.branch;
$('cfgFile').textContent = config.dataFile;

$('pat').value = getPAT();
$('nick').value = getNick();

$('patSave').addEventListener('click', () => {
  setPAT($('pat').value.trim());
  setNick($('nick').value.trim());
  $('patStatus').innerHTML = '<span style="color:#006400;">保存しました</span>';
});
$('patClear').addEventListener('click', () => {
  setPAT('');
  $('pat').value = '';
  $('patStatus').innerHTML = 'クリアしました';
});

$('qrShow').addEventListener('click', async () => {
  const pat = getPAT();
  if (!pat) {
    $('patStatus').innerHTML = '<span class="error">先にPATを保存してください</span>';
    return;
  }
  const base = location.origin + location.pathname.replace(/[^/]*$/, '') + 'index.html';
  const url = `${base}#token=${encodeURIComponent(pat)}`;
  $('qrUrl').textContent = url;
  $('qrArea').style.display = 'block';
  await QRCode.toCanvas($('qrCanvas'), url, { width: 240, margin: 2 });
});
$('qrHide').addEventListener('click', () => {
  $('qrArea').style.display = 'none';
});
