/**
 * 生成 ECDSA P-256 密钥对。
 * 私钥只保存在你自己电脑的 tools/keys/private.pem，绝不能上传到网页仓库。
 * 公钥 JWK 复制到 js/config.js 的 AUTH.publicKeyJwk。
 *
 * 运行：node tools/keygen.mjs
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, "keys");
mkdirSync(outDir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const publicJwk = publicKey.export({ format: "jwk" });

writeFileSync(join(outDir, "private.pem"), privatePem, "utf8");
writeFileSync(join(outDir, "public.pem"), publicPem, "utf8");

console.log("已生成密钥：");
console.log("  私钥：" + join(outDir, "private.pem") + "（只留在本机，绝对不要提交到 GitHub）");
console.log("  公钥：" + join(outDir, "public.pem"));
console.log("\n请把下面的 publicJwk 完整粘贴到 js/config.js 的 AUTH.publicKeyJwk：\n");
console.log(JSON.stringify(publicJwk, null, 2));
