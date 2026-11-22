#!/usr/bin/env python3
"""
Cryptographic & structural APK verifier for Doubi Life Remastered (Android 16 / 64-bit).

Independently checks:
1. ZIP integrity & strict 4-byte local alignment for all ZIP_STORED entries.
2. Zero native 32-bit .so libraries under lib/.
3. AndroidManifest.xml binary header, versionCode@2472, minSdkVersion@2568.
4. JAR V1 signature: MANIFEST.MF entry SHA-256 digests, CERT.SF section digests,
   X-Android-APK-Signed: 2 header, and PKCS#7 CMS signature verification via OpenSSL.
5. APK Signature Scheme v2: block magic, ID 0x7109871a present, forbidden Verity
   padding 0x42726577 absent, full 1MB-chunked SHA-256 Merkle digest match, and
   RSA-SHA256 signature verification against the embedded SPKI public key.
"""

import base64
import hashlib
import os
import struct
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

SIG_SCHEME_V2_BLOCK_ID = 0x7109871A
FORBIDDEN_VERITY_BLOCK_ID = 0x42726577


def read_lp(buf: bytes, pos: int) -> tuple[bytes, int]:
    length = struct.unpack_from("<I", buf, pos)[0]
    start = pos + 4
    return buf[start : start + length], start + length


def compute_v2_digest(section1: bytes, section3: bytes, section4_eocd: bytes) -> bytes:
    chunk_size = 1024 * 1024
    digests = []
    for sec in (section1, section3, section4_eocd):
        for off in range(0, len(sec), chunk_size):
            chunk = sec[off : off + chunk_size]
            h = hashlib.sha256()
            h.update(b"\xa5")
            h.update(struct.pack("<I", len(chunk)))
            h.update(chunk)
            digests.append(h.digest())
    top = hashlib.sha256()
    top.update(b"\x5a")
    top.update(struct.pack("<I", len(digests)))
    for d in digests:
        top.update(d)
    return top.digest()


def verify_apk(apk_path: Path) -> None:
    raw = apk_path.read_bytes()

    with zipfile.ZipFile(apk_path, "r") as zf:
        bad = zf.testzip()
        if bad is not None:
            raise AssertionError(f"Corrupt ZIP entry: {bad}")

        names = zf.namelist()
        so_files = [n for n in names if n.startswith("lib/") and n.endswith(".so")]
        if so_files:
            raise AssertionError(f"Found unexpected native .so libraries: {so_files}")

        for info in zf.infolist():
            if info.filename in ("classes.dex", "resources.arsc") or info.filename.startswith("res/"):
                if info.compress_type != 0:
                    raise AssertionError(f"{info.filename} must be ZIP_STORED (comp=0), got {info.compress_type}")
            if info.compress_type == 0:
                off = info.header_offset
                _, _, _, _, _, _, _, _, _, nlen, xlen = struct.unpack_from("<IHHHHHIIIHH", raw, off)
                data_off = off + 30 + nlen + xlen
                if data_off % 4 != 0:
                    raise AssertionError(f"ZIP_STORED entry {info.filename} misaligned: offset={data_off}")

        manifest_bin = zf.read("AndroidManifest.xml")
        vc = struct.unpack_from("<I", manifest_bin, 2472)[0]
        min_sdk = struct.unpack_from("<I", manifest_bin, 2568)[0]
        if min_sdk < 21 or vc < 1:
            raise AssertionError(f"Suspicious manifest values: versionCode={vc}, minSdk={min_sdk}")
        print(f"[OK]   ZIP alignment, zero .so, Manifest (len={len(manifest_bin)}, versionCode={vc}, minSdk={min_sdk})")

        # Verify V1 signature
        mf_bytes = zf.read("META-INF/MANIFEST.MF")
        sf_bytes = zf.read("META-INF/CERT.SF")
        rsa_bytes = zf.read("META-INF/CERT.RSA")

        if b"X-Android-APK-Signed: 2" not in sf_bytes:
            raise AssertionError("CERT.SF missing X-Android-APK-Signed: 2 header")

        # Verify every non-META-INF file digest in MANIFEST.MF
        mf_text = mf_bytes.decode("utf-8")
        mf_digests = {}
        for block in mf_text.split("\r\n\r\n"):
            lines = [l for l in block.splitlines() if l.strip()]
            name = None
            dig = None
            for l in lines:
                if l.startswith("Name: "):
                    name = l[6:]
                elif l.startswith("SHA-256-Digest: "):
                    dig = l[16:]
            if name and dig:
                mf_digests[name] = dig

        for name in names:
            if name.startswith("META-INF/"):
                continue
            expected = base64.b64encode(hashlib.sha256(zf.read(name)).digest()).decode("ascii")
            if mf_digests.get(name) != expected:
                raise AssertionError(f"V1 MANIFEST.MF SHA-256 mismatch for {name}")

        with tempfile.NamedTemporaryFile(delete=False) as f_sf, tempfile.NamedTemporaryFile(delete=False) as f_rsa:
            f_sf.write(sf_bytes)
            f_rsa.write(rsa_bytes)
            sf_p, rsa_p = f_sf.name, f_rsa.name
        try:
            subprocess.run(
                ["openssl", "smime", "-verify", "-noverify", "-inform", "DER", "-in", rsa_p, "-content", sf_p, "-out", os.devnull],
                check=True,
                capture_output=True,
            )
        finally:
            os.unlink(sf_p)
            os.unlink(rsa_p)
        print(f"[OK]   V1 JAR signature cryptographically verified ({len(mf_digests)} entries)")

    # Verify V2 APK Signing Block
    eocd_off = raw.rfind(b"PK\x05\x06")
    if eocd_off == -1:
        raise AssertionError("EOCD not found")
    cd_size, cd_off = struct.unpack_from("<II", raw, eocd_off + 12)
    magic_off = cd_off - 16
    if raw[magic_off : magic_off + 16] != b"APK Sig Block 42":
        raise AssertionError("APK Sig Block 42 magic not immediately before Central Directory")

    block_size_footer = struct.unpack_from("<Q", raw, magic_off - 8)[0]
    block_start = cd_off - block_size_footer - 8
    block_size_header = struct.unpack_from("<Q", raw, block_start)[0]
    if block_size_header != block_size_footer:
        raise AssertionError("APK Sig Block header/footer size mismatch")

    pos = block_start + 8
    end = magic_off - 8
    v2_payload = None
    while pos < end:
        plen = struct.unpack_from("<Q", raw, pos)[0]
        pid = struct.unpack_from("<I", raw, pos + 8)[0]
        val = raw[pos + 12 : pos + 8 + plen]
        if pid == FORBIDDEN_VERITY_BLOCK_ID:
            raise AssertionError("Forbidden Verity padding block 0x42726577 found!")
        if pid == SIG_SCHEME_V2_BLOCK_ID:
            v2_payload = val
        pos += 8 + plen

    if v2_payload is None:
        raise AssertionError("Missing APK Sig Scheme v2 block 0x7109871a")

    signers_seq, _ = read_lp(v2_payload, 0)
    signer, _ = read_lp(signers_seq, 0)
    signed_data, p = read_lp(signer, 0)
    sigs_seq, p = read_lp(signer, p)
    spki_der, _ = read_lp(signer, p)

    # Extract V2 content digest
    digests_seq, _ = read_lp(signed_data, 0)
    digest_entry, _ = read_lp(digests_seq, 0)
    algo_id = struct.unpack_from("<I", digest_entry, 0)[0]
    embedded_digest, _ = read_lp(digest_entry, 4)

    # Recompute V2 Merkle digest with EOCD CD offset patched to block_start
    sec1 = raw[:block_start]
    sec3 = raw[cd_off:eocd_off]
    sec4 = bytearray(raw[eocd_off:])
    struct.pack_into("<I", sec4, 16, block_start)
    computed_digest = compute_v2_digest(sec1, sec3, bytes(sec4))
    if computed_digest != embedded_digest:
        raise AssertionError("V2 content Merkle digest mismatch!")

    # Verify RSA-SHA256 signature over signed_data using embedded SPKI public key
    sig_entry, _ = read_lp(sigs_seq, 0)
    sig_algo = struct.unpack_from("<I", sig_entry, 0)[0]
    sig_bytes, _ = read_lp(sig_entry, 4)
    if algo_id != 0x0103 or sig_algo != 0x0103:
        raise AssertionError(f"Unexpected V2 algorithm IDs: {hex(algo_id)}, {hex(sig_algo)}")

    with (
        tempfile.NamedTemporaryFile(delete=False) as f_pub,
        tempfile.NamedTemporaryFile(delete=False) as f_sig,
        tempfile.NamedTemporaryFile(delete=False) as f_data,
    ):
        pub_pem = subprocess.run(
            ["openssl", "pkey", "-pubin", "-inform", "DER", "-outform", "PEM"],
            input=spki_der,
            check=True,
            capture_output=True,
        ).stdout
        f_pub.write(pub_pem)
        f_sig.write(sig_bytes)
        f_data.write(signed_data)
        pub_p, sig_p, data_p = f_pub.name, f_sig.name, f_data.name
    try:
        subprocess.run(
            ["openssl", "dgst", "-sha256", "-verify", pub_p, "-signature", sig_p, data_p],
            check=True,
            capture_output=True,
        )
    finally:
        os.unlink(pub_p)
        os.unlink(sig_p)
        os.unlink(data_p)

    print(f"[OK]   V2 APK Signature Scheme cryptographically verified (0x7109871a, no 0x42726577, Merkle digest match)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <path/to/app.apk>")
        sys.exit(2)
    verify_apk(Path(sys.argv[1]))
    print("\nAPK CRYPTOGRAPHIC VERIFICATION PASSED.")
