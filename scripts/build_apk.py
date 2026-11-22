#!/usr/bin/env python3
"""
Reproducible pure-64-bit Android APK builder for Doubi Life Remastered.

Produces a 4-byte aligned, V1+V2 signed APK compatible with Android 9 through
Android 16 (pure 64-bit devices) using only Python 3 and OpenSSL.

Key invariants enforced:
- Patches versionCode in-place at offset 2472 of the aapt-compiled binary
  AndroidManifest.xml (never reconstructs the binary XML tree).
- Stores classes.dex, resources.arsc, and res/* uncompressed (ZIP_STORED) with
  strict 4-byte data alignment via local header extra-field padding.
- Signs with both JAR V1 (X-Android-APK-Signed: 2) and APK Signature Scheme v2
  (block ID 0x7109871a), without the 0x42726577 Verity padding block.
"""

import argparse
import base64
import hashlib
import os
import struct
import subprocess
import tempfile
import zipfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MANIFEST_VERSION_CODE_OFFSET = 2472
SIG_SCHEME_V2_BLOCK_ID = 0x7109871A
SIG_ALGO_RSA_PKCS1_V15_SHA256 = 0x0103


def ensure_keypair(key_path: Path, cert_path: Path) -> None:
    if key_path.exists() and cert_path.exists():
        return
    key_path.parent.mkdir(parents=True, exist_ok=True)
    cert_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "openssl",
            "req",
            "-x509",
            "-newkey",
            "rsa:2048",
            "-nodes",
            "-keyout",
            str(key_path),
            "-out",
            str(cert_path),
            "-days",
            "10000",
            "-subj",
            "/C=CN/ST=SG/L=ShenGuo/O=Doubi/OU=MsgJug/CN=DoubiRemastered",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    print(f"[INFO] Generated new local signing keypair at {key_path} and {cert_path}")


def collect_entries(version_code: int | None) -> list[tuple[str, bytes, bool]]:
    """Return list of (arcname, data, store_uncompressed) in deterministic order."""
    android_dir = ROOT / "android"
    manifest = bytearray((android_dir / "AndroidManifest.xml").read_bytes())
    if version_code is not None:
        struct.pack_into("<I", manifest, MANIFEST_VERSION_CODE_OFFSET, version_code)

    entries: list[tuple[str, bytes, bool]] = [
        ("AndroidManifest.xml", bytes(manifest), False),
        ("classes.dex", (android_dir / "classes.dex").read_bytes(), True),
        ("resources.arsc", (android_dir / "resources.arsc").read_bytes(), True),
    ]

    res_dir = android_dir / "res"
    for p in sorted(res_dir.rglob("*")):
        if p.is_file():
            rel = "res/" + p.relative_to(res_dir).as_posix()
            entries.append((rel, p.read_bytes(), True))

    entries.append(("assets/index.html", (ROOT / "index.html").read_bytes(), False))
    return entries


def build_v1_signature(
    entries: list[tuple[str, bytes, bool]], key_path: Path, cert_path: Path
) -> list[tuple[str, bytes, bool]]:
    manifest_lines = [
        "Manifest-Version: 1.0",
        "Created-By: Doubi-Remastered-Builder",
        "",
    ]
    sf_entries = []

    for name, data, _ in entries:
        digest_b64 = base64.b64encode(hashlib.sha256(data).digest()).decode("ascii")
        section = f"Name: {name}\r\nSHA-256-Digest: {digest_b64}\r\n\r\n"
        manifest_lines.append(f"Name: {name}")
        manifest_lines.append(f"SHA-256-Digest: {digest_b64}")
        manifest_lines.append("")
        sec_digest_b64 = base64.b64encode(
            hashlib.sha256(section.encode("utf-8")).digest()
        ).decode("ascii")
        sf_entries.append(f"Name: {name}\r\nSHA-256-Digest: {sec_digest_b64}\r\n\r\n")

    manifest_bytes = ("\r\n".join(manifest_lines[:-1]) + "\r\n\r\n").encode("utf-8")
    manifest_digest_b64 = base64.b64encode(
        hashlib.sha256(manifest_bytes).digest()
    ).decode("ascii")

    sf_header = (
        "Signature-Version: 1.0\r\n"
        "Created-By: Doubi-Remastered-Builder\r\n"
        f"SHA-256-Digest-Manifest: {manifest_digest_b64}\r\n"
        "X-Android-APK-Signed: 2\r\n\r\n"
    )
    sf_bytes = (sf_header + "".join(sf_entries)).encode("utf-8")

    with tempfile.NamedTemporaryFile(delete=False) as tmp_sf:
        tmp_sf.write(sf_bytes)
        tmp_sf_path = tmp_sf.name

    try:
        proc = subprocess.run(
            [
                "openssl",
                "smime",
                "-sign",
                "-binary",
                "-in",
                tmp_sf_path,
                "-signer",
                str(cert_path),
                "-inkey",
                str(key_path),
                "-outform",
                "DER",
                "-noattr",
                "-md",
                "sha256",
            ],
            check=True,
            capture_output=True,
        )
        rsa_bytes = proc.stdout
    finally:
        os.unlink(tmp_sf_path)

    return [
        ("META-INF/MANIFEST.MF", manifest_bytes, False),
        ("META-INF/CERT.SF", sf_bytes, False),
        ("META-INF/CERT.RSA", rsa_bytes, False),
    ]


def build_aligned_zip(entries: list[tuple[str, bytes, bool]]) -> tuple[bytes, int, int]:
    """Build ZIP with 4-byte local alignment for ZIP_STORED entries.

    Returns (zip_bytes, cd_offset, eocd_offset).
    """
    out = bytearray()
    cd_records = bytearray()

    for name, data, store in entries:
        name_bytes = name.encode("utf-8")
        crc = zlib.crc32(data) & 0xFFFFFFFF
        uncomp_size = len(data)

        if store:
            comp_method = 0
            comp_data = data
        else:
            comp_method = 8
            compressor = zlib.compressobj(9, zlib.DEFLATED, -15)
            comp_data = compressor.compress(data) + compressor.flush()

        comp_size = len(comp_data)
        local_offset = len(out)

        extra = b""
        if store:
            data_pos = local_offset + 30 + len(name_bytes)
            pad = (4 - (data_pos % 4)) % 4
            extra = b"\x00" * pad

        local_header = struct.pack(
            "<IHHHHHIIIHH",
            0x04034B50,  # Local file header signature
            20,          # Version needed
            0,           # Flags
            comp_method,
            0,           # Mod time
            0x0021,      # Mod date (1980-01-01)
            crc,
            comp_size,
            uncomp_size,
            len(name_bytes),
            len(extra),
        )
        out.extend(local_header)
        out.extend(name_bytes)
        out.extend(extra)
        out.extend(comp_data)

        cd_header = struct.pack(
            "<IHHHHHHIIIHHHHHII",
            0x02014B50,  # Central directory header signature
            20,          # Version made by
            20,          # Version needed
            0,           # Flags
            comp_method,
            0,
            0x0021,
            crc,
            comp_size,
            uncomp_size,
            len(name_bytes),
            0,           # Extra length in CD
            0,           # Comment length
            0,           # Disk number
            0,           # Internal attrs
            0,           # External attrs
            local_offset,
        )
        cd_records.extend(cd_header)
        cd_records.extend(name_bytes)

    cd_offset = len(out)
    out.extend(cd_records)
    eocd_offset = len(out)

    eocd = struct.pack(
        "<IHHHHIIH",
        0x06054B50,
        0,
        0,
        len(entries),
        len(entries),
        len(cd_records),
        cd_offset,
        0,
    )
    out.extend(eocd)
    return bytes(out), cd_offset, eocd_offset


def lp(data: bytes) -> bytes:
    return struct.pack("<I", len(data)) + data


def compute_v2_digest(section1: bytes, section3: bytes, section4_eocd: bytes) -> bytes:
    chunk_size = 1024 * 1024
    chunk_digests: list[bytes] = []
    for section in (section1, section3, section4_eocd):
        for offset in range(0, len(section), chunk_size):
            chunk = section[offset : offset + chunk_size]
            h = hashlib.sha256()
            h.update(b"\xa5")
            h.update(struct.pack("<I", len(chunk)))
            h.update(chunk)
            chunk_digests.append(h.digest())

    top = hashlib.sha256()
    top.update(b"\x5a")
    top.update(struct.pack("<I", len(chunk_digests)))
    for d in chunk_digests:
        top.update(d)
    return top.digest()


def add_v2_signature(
    zip_bytes: bytes, cd_offset: int, eocd_offset: int, key_path: Path, cert_path: Path
) -> bytes:
    section1 = zip_bytes[:cd_offset]
    section3 = zip_bytes[cd_offset:eocd_offset]
    section4 = bytearray(zip_bytes[eocd_offset:])

    # Per APK Sig v2 spec, EOCD CD offset equals the APK Signing Block start (= cd_offset)
    struct.pack_into("<I", section4, 16, cd_offset)
    digest = compute_v2_digest(section1, section3, bytes(section4))

    cert_der = subprocess.run(
        ["openssl", "x509", "-in", str(cert_path), "-outform", "DER"],
        check=True,
        capture_output=True,
    ).stdout

    pubkey_pem = subprocess.run(
        ["openssl", "x509", "-in", str(cert_path), "-pubkey", "-noout"],
        check=True,
        capture_output=True,
    ).stdout
    spki_der = subprocess.run(
        ["openssl", "pkey", "-pubin", "-outform", "DER"],
        input=pubkey_pem,
        check=True,
        capture_output=True,
    ).stdout

    digests_seq = lp(lp(struct.pack("<I", SIG_ALGO_RSA_PKCS1_V15_SHA256) + lp(digest)))
    certs_seq = lp(lp(cert_der))
    attrs_seq = lp(b"")
    signed_data = digests_seq + certs_seq + attrs_seq

    signature = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", str(key_path)],
        input=signed_data,
        check=True,
        capture_output=True,
    ).stdout

    signatures_seq = lp(
        lp(struct.pack("<I", SIG_ALGO_RSA_PKCS1_V15_SHA256) + lp(signature))
    )
    signer = lp(signed_data) + signatures_seq + lp(spki_der)
    v2_value = lp(lp(signer))

    pair_body = struct.pack("<I", SIG_SCHEME_V2_BLOCK_ID) + v2_value
    pair = struct.pack("<Q", len(pair_body)) + pair_body

    # Strictly omit 0x42726577 Verity padding block for Android 16 installer compatibility
    block_size = len(pair) + 8 + 16
    sig_block = (
        struct.pack("<Q", block_size)
        + pair
        + struct.pack("<Q", block_size)
        + b"APK Sig Block 42"
    )

    patched_eocd = bytearray(zip_bytes[eocd_offset:])
    struct.pack_into("<I", patched_eocd, 16, cd_offset + len(sig_block))
    return section1 + sig_block + section3 + bytes(patched_eocd)


def verify_apk_layout(apk_path: Path) -> None:
    raw = apk_path.read_bytes()
    with zipfile.ZipFile(apk_path, "r") as zf:
        bad = zf.testzip()
        if bad is not None:
            raise RuntimeError(f"ZIP CRC error in {bad}")
        for info in zf.infolist():
            if info.compress_type == 0:
                off = info.header_offset
                _, _, _, _, _, _, _, _, _, nlen, xlen = struct.unpack_from(
                    "<IHHHHHIIIHH", raw, off
                )
                data_off = off + 30 + nlen + xlen
                if data_off % 4 != 0:
                    raise RuntimeError(
                        f"Stored entry {info.filename} is not 4-byte aligned (offset={data_off})"
                    )

    magic_idx = raw.rfind(b"APK Sig Block 42")
    if magic_idx == -1:
        raise RuntimeError("Missing APK Sig Block 42")
    block_size = struct.unpack_from("<Q", raw, magic_idx - 8)[0]
    start = magic_idx + 16 - block_size - 8
    pos = start + 8
    end = magic_idx - 8
    ids = []
    while pos < end:
        plen = struct.unpack_from("<Q", raw, pos)[0]
        pid = struct.unpack_from("<I", raw, pos + 8)[0]
        ids.append(pid)
        pos += 8 + plen
    if SIG_SCHEME_V2_BLOCK_ID not in ids:
        raise RuntimeError("Missing V2 signature block ID 0x7109871a")
    if 0x42726577 in ids:
        raise RuntimeError("Forbidden Verity padding block 0x42726577 present")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build 64-bit Doubi Life Remastered APK")
    parser.add_argument(
        "--out",
        default=str(ROOT / "dist" / "doubi-life-64bit.apk"),
        help="Output APK path",
    )
    parser.add_argument(
        "--key",
        default=str(ROOT / "keystore" / "release.key"),
        help="PEM private key path (auto-generated if absent)",
    )
    parser.add_argument(
        "--cert",
        default=str(ROOT / "keystore" / "release.crt"),
        help="PEM certificate path (auto-generated if absent)",
    )
    parser.add_argument(
        "--version-code",
        type=int,
        default=None,
        help="Optional integer versionCode to patch in-place in AndroidManifest.xml",
    )
    args = parser.parse_args()

    out_path = Path(args.out)
    key_path = Path(args.key)
    cert_path = Path(args.cert)

    ensure_keypair(key_path, cert_path)
    entries = collect_entries(args.version_code)
    v1_entries = build_v1_signature(entries, key_path, cert_path)
    zip_bytes, cd_offset, eocd_offset = build_aligned_zip(entries + v1_entries)
    signed_apk = add_v2_signature(zip_bytes, cd_offset, eocd_offset, key_path, cert_path)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(signed_apk)
    verify_apk_layout(out_path)
    print(f"[OK] Built and verified pure-64-bit APK: {out_path} ({len(signed_apk):,} bytes)")


if __name__ == "__main__":
    main()
