/* Mahjuris · configuração do site e do app.
   Preencha com os dados do seu projeto no Supabase (Project Settings > API).
   A "anon key" (chave pública) pode ficar aqui: quem protege os dados são as regras do banco (RLS).
   NUNCA coloque aqui a "service_role key". */
window.MJ_CONFIG={
  supabaseUrl:"https://jlqebasuldrmwrsyrkdc.supabase.co",
  supabaseAnonKey:"sb_publishable_hXzH5QqU_XOyuK6g33HyqA_6ZHwGy7J", // chave publicável (pública)
  siteUrl:"",              // endereço do site, ex.: "https://mahjuris.pages.dev" (usado nos e-mails e no app)
  premiumPreco:"R$ 19,90 por ano", // texto mostrado no convite e na página Premium
  limitesAtivos:false,     // false = tudo liberado para todos (enquanto o app não vende o Premium). true = liga os limites do Free
  free:{jogadasPorDia:5, baralhosProprios:2, cartasPorBaralho:100},
  // planos que criam grupos de ranking (textos do app; quem vale de verdade é a coluna plano em profiles, ver supabase/ranking-grupos.sql)
  planosGrupo:{plus:{nome:"Premium Plus",preco:"R$ 39,90 por ano",grupos:5,pessoas:10}, turma:{nome:"Plano Turma",preco:"R$ 99,90 por ano",grupos:20,pessoas:40}}
};
