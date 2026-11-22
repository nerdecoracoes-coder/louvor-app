/**
 * Pinta de AZUL, na SUA visão do Google Drive, as pastas de música que estão prontas.
 * Pronta = tem, direto na pasta, um projeto do Reaper chamado "Música - Cantor - 140 BPM (Tom)" e uma foto JPEG.
 * As demais ficam como estão. Só mexe nas pastas DENTRO da "multitracks"; o restante do Drive nunca é tocado.
 * O script apenas lê nomes e muda a cor: não renomeia, move, apaga nem edita nenhum arquivo. É a mesma regra que o Somos usa para liberar o player.
 *
 * Como usar: script.google.com > Novo projeto > cole este código > troque PASTA_ID abaixo >
 * Executar "colorirPastas" (autorize na primeira vez). Para rodar sozinho: execute "ativarAutomatico" uma vez.
 */
const PASTA_ID = "COLE_AQUI_O_ID_DA_PASTA_MULTITRACKS";   // o trecho depois de /folders/ no link da pasta

const NOME_PRONTO = /^(.+?)\s*-\s*(.+?)\s*-\s*\d{2,3}([.,]\d+)?\s*bpms?\s*\(\s*[A-Ga-g][#b♯♭]?m?\s*\)$/i;

function prontaPasta_(pasta) {
  let projeto = false, foto = false;
  const arqs = pasta.getFiles();
  while (arqs.hasNext()) {
    const a = arqs.next(), n = a.getName();
    if (/\.rpp$/i.test(n) && NOME_PRONTO.test(n.replace(/\.rpp$/i, "").normalize("NFC").trim())) projeto = true;
    if (/\.jpe?g$/i.test(n)) foto = true;
    if (projeto && foto) return true;
  }
  return false;
}

function temArquivos_(pasta) { return pasta.getFiles().hasNext(); }

function colorirPastas() {
  const inicio = Date.now();
  const props = PropertiesService.getScriptProperties();
  const antes = new Set(lerAzuis_(props));
  const agora = [];
  let azuis = 0, incompletas = 0;

  const visitar = (pasta, nivel) => {
    const subs = pasta.getFolders();
    while (subs.hasNext()) {
      if (Date.now() - inicio > 5 * 60 * 1000) return;   // limite do Apps Script: 6 min
      const f = subs.next();
      // pasta de cantor/grupo: sem arquivos próprios, só subpastas
      if (nivel < 2 && !temArquivos_(f) && f.getFolders().hasNext()) { visitar(f, nivel + 1); continue; }
      if (/-\s*editar\s*$/i.test(f.getName())) continue;   // pastas "- Editar" são ignoradas, como no app
      if (prontaPasta_(f)) {
        f.setColor(DriveApp.Color.BLUE); agora.push(f.getId()); azuis++;
      } else {
        incompletas++;
        if (antes.has(f.getId())) f.setColor(DriveApp.Color.GRAY);   // deixou de estar pronta: volta ao cinza
      }
    }
  };

  // Trava de segurança: só trabalha dentro da pasta indicada, e só se ela se chamar "multitracks".
  const raiz = DriveApp.getFolderById(PASTA_ID);
  if (raiz.getName().toLowerCase() !== "multitracks") throw new Error('PASTA_ID não é a pasta "multitracks" — nada foi alterado.');
  visitar(raiz, 1);
  gravarAzuis_(props, agora);
  Logger.log("Prontas (azul): " + azuis + " · Incompletas: " + incompletas);
}

function ativarAutomatico() {   // roda a cada hora
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("colorirPastas").timeBased().everyHours(1).create();
}

// guarda quais pastas pintamos (as propriedades têm limite de tamanho: 100 ids por chave)
function lerAzuis_(props) {
  const out = [];
  for (let i = 0; ; i++) { const v = props.getProperty("azuis" + i); if (!v) break; out.push(...v.split(",")); }
  return out;
}
function gravarAzuis_(props, ids) {
  for (let i = 0; i < 100; i++) props.deleteProperty("azuis" + i);
  for (let i = 0; i * 100 < ids.length; i++) props.setProperty("azuis" + i, ids.slice(i * 100, i * 100 + 100).join(","));
}
