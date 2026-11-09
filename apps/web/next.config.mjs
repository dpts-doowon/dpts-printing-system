/**
 * Publicação em subcaminho (ex.: https://doowonbrasil.net/etiquetas): defina NEXT_PUBLIC_BASE_PATH=/etiquetas
 * e NEXT_PUBLIC_API_URL=/etiquetas/api na construção. Com API_INTERNAL_URL (endereço da API), este servidor
 * repassa /<basePath>/api/* para a API, de modo que o domínio precisa encaminhar apenas /etiquetas.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  transpilePackages: ["@doowon/shared"],
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  async rewrites() {
    const api = process.env.API_INTERNAL_URL;
    return api ? [{ source: "/api/:path*", destination: `${api.replace(/\/+$/, "")}/:path*` }] : [];
  },
};
export default nextConfig;
