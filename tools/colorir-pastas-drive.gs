/**
 * Pinta de AZUL, na SUA visao do Google Drive, as pastas de musica que estao prontas.
 * Pronta = tem, direto na pasta, um projeto do Reaper chamado "Musica - Cantor - 140 BPM (Tom)" e uma foto JPEG.
 * As demais ficam como estao. So mexe nas pastas DENTRO da "multitracks"; o restante do Drive nunca e tocado.
 * O script apenas le nomes e muda a cor: nao renomeia, move, apaga nem edita nenhum arquivo. E a mesma regra que o Somos usa para liberar o player.
 *
 * Como usar: script.google.com > Novo projeto > cole este codigo > troque PASTA_ID abaixo >
 * Executar "colorirPastas" (autorize na primeira vez). Para rodar sozinho: execute "ativarAutomatico" uma vez.
 */
const PASTA_ID = "COLE_AQUI_O_ID_DA_PASTA_MULTITRACKS";   // o trecho depois de /folders/ no link da pasta

const NOME_PRONTO = /^(.+?)\s*-\s*(.+?)\s*-\s*\d{2,3}([.,]\d+)?\s*bpms?\s*\(\s*[A-Ga-g][#b\u266F\u266D]?m?\s*\)$/i;

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

var AZUL = "#4986e7", CINZA = "#8f8f8f";

// O Apps Script nao tem comando de cor para pastas: usamos a API do Drive com a sua propria autorizacao.
function api_(id, metodo, corpo) {
  const r = UrlFetchApp.fetch("https://www.googleapis.com/drive/v3/files/" + id + "?supportsAllDrives=true&fields=id,folderColorRgb", {
    method: metodo, contentType: "application/json", payload: corpo ? JSON.stringify(corpo) : null,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  });
  if (r.getResponseCode() >= 300) throw new Error("Drive " + r.getResponseCode() + ": " + r.getContentText().slice(0, 200));
  return JSON.parse(r.getContentText());
}

function colorirPastas() {
  const inicio = Date.now();
  let azuis = 0, incompletas = 0, mudadas = 0;

  const visitar = (pasta, nivel) => {
    const subs = pasta.getFolders();
    while (subs.hasNext()) {
      if (Date.now() - inicio > 5 * 60 * 1000) { Logger.log("Tempo esgotado: rode de novo para continuar."); return; }
      const f = subs.next();
      // pasta de cantor/grupo: sem arquivos proprios, so subpastas
      if (nivel < 2 && !temArquivos_(f) && f.getFolders().hasNext()) { visitar(f, nivel + 1); continue; }
      if (/-\s*editar\s*$/i.test(f.getName())) continue;   // pastas "- Editar" sao ignoradas, como no app
      const cor = (api_(f.getId(), "get").folderColorRgb || "").toLowerCase();
      if (prontaPasta_(f)) {
        azuis++;
        if (cor !== AZUL) { api_(f.getId(), "patch", { folderColorRgb: AZUL }); mudadas++; }
      } else {
        incompletas++;
        if (cor === AZUL) { api_(f.getId(), "patch", { folderColorRgb: CINZA }); mudadas++; }   // deixou de estar pronta: volta ao cinza
      }
    }
  };

  // Trava de seguranca: so trabalha dentro da pasta indicada, e so se ela se chamar "multitracks".
  const raiz = DriveApp.getFolderById(String(PASTA_ID).split("?")[0].trim());   // aceita o ID mesmo com "?hl=pt-br" colado junto
  if (raiz.getName().toLowerCase() !== "multitracks") throw new Error('PASTA_ID nao e a pasta "multitracks" - nada foi alterado.');
  visitar(raiz, 1);
  Logger.log("Prontas (azul): " + azuis + " - Incompletas: " + incompletas + " - Cores alteradas agora: " + mudadas);
}

function ativarAutomatico() {   // roda a cada hora
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("colorirPastas").timeBased().everyHours(1).create();
}
