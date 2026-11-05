// Consulta dados cadastrais de uma empresa pelo CNPJ (dados públicos da Receita Federal).
// Tenta a BrasilAPI e, se falhar, a API pública do CNPJ.ws. Devolve um formato único.
export async function onRequest(context) {
  const { request, env } = context;

  const authHeader = request.headers.get("Authorization");
  if (!authHeader || authHeader !== `Bearer ${env.NEWSMAKER_PASSWORD}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const cnpj = (new URL(request.url).searchParams.get("cnpj") || "").replace(/\D/g, "");
  if (cnpj.length !== 14) {
    return json({ error: "CNPJ deve ter 14 dígitos." }, 400);
  }
  if (!isValidCnpj(cnpj)) {
    return json({ error: "CNPJ inválido: confira os números digitados." }, 400);
  }

  let notFound = false;
  for (const source of [fromBrasilApi, fromCnpjWs]) {
    try {
      const data = await source(cnpj);
      if (data) return json(data);
      notFound = true;
    } catch (e) {
      // tenta a próxima fonte
    }
  }

  return notFound
    ? json({ error: "CNPJ não encontrado na Receita Federal." }, 404)
    : json({ error: "Não foi possível consultar o CNPJ agora. Tente de novo em instantes." }, 502);
}

const headers = { "Accept": "application/json", "User-Agent": "radiopopfm-contratos" };

async function fromBrasilApi(cnpj) {
  const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`BrasilAPI ${res.status}`);
  const d = await res.json();
  return normalize({
    razaoSocial: d.razao_social,
    nomeFantasia: d.nome_fantasia,
    situacao: d.descricao_situacao_cadastral,
    tipoLogradouro: d.descricao_tipo_de_logradouro,
    logradouro: d.logradouro,
    numero: d.numero,
    complemento: d.complemento,
    bairro: d.bairro,
    cidade: d.municipio,
    uf: d.uf,
    cep: d.cep,
    email: d.email,
    telefone: d.ddd_telefone_1,
  });
}

async function fromCnpjWs(cnpj) {
  const res = await fetch(`https://publica.cnpj.ws/cnpj/${cnpj}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`CNPJ.ws ${res.status}`);
  const d = await res.json();
  const e = d.estabelecimento || {};
  return normalize({
    razaoSocial: d.razao_social,
    nomeFantasia: e.nome_fantasia,
    situacao: e.situacao_cadastral,
    tipoLogradouro: e.tipo_logradouro,
    logradouro: e.logradouro,
    numero: e.numero,
    complemento: e.complemento,
    bairro: e.bairro,
    cidade: e.cidade && e.cidade.nome,
    uf: e.estado && e.estado.sigla,
    cep: e.cep,
    email: e.email,
    telefone: (e.ddd1 || "") + (e.telefone1 || ""),
  });
}

function normalize(r) {
  const up = (v) => (v == null ? "" : String(v).trim().replace(/\s+/g, " ").toUpperCase());
  const tipo = up(r.tipoLogradouro);
  const logradouro = up(r.logradouro);
  const cep = String(r.cep || "").replace(/\D/g, "");
  return {
    razaoSocial: up(r.razaoSocial),
    nomeFantasia: up(r.nomeFantasia),
    situacao: up(r.situacao),
    endereco: tipo && !logradouro.startsWith(tipo + " ") ? `${tipo} ${logradouro}` : logradouro,
    numero: up(r.numero),
    complemento: up(r.complemento),
    bairro: up(r.bairro),
    cidade: up(r.cidade),
    uf: up(r.uf),
    cep: cep.length === 8 ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep,
    email: String(r.email || "").trim().toLowerCase(),
    telefone: formatPhone(r.telefone),
  };
}

function isValidCnpj(c) {
  if (/^(\d)\1{13}$/.test(c)) return false;
  const digit = (len) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((acc, w, i) => acc + w * Number(c[i]), 0);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === Number(c[12]) && digit(13) === Number(c[13]);
}

function formatPhone(v) {
  const d = String(v || "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return d;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
