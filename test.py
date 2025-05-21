import base64
import re
import json
from urllib.parse import urlparse, urlunparse

def normalize_url(url):
    """Fix URLs with double HTTPS prefixes and remove query parameters"""
    if '/https://' in url:
        url = 'https://' + url.split('/https://')[-1]
    return url.split('?')[0].split('#')[0]

base64_str = "base64string"
decoded_data = base64.b64decode(base64_str)
with open("output.bin", "wb") as f:
    f.write(decoded_data)

with open("output.bin", "rb") as f:
    data = f.read()

segments = re.split(rb'[\x00-\x1F]+', data)
url_pattern = re.compile(rb'https?://[^\s\x00-\x1F<>]*\.(?:gif|mp4)[^\s\x00-\x1F<>]*')
urls = []

for segment in segments:
    decoded_segment = segment.decode('latin-1', errors='ignore')
    matches = url_pattern.findall(decoded_segment.encode('latin-1'))
    urls.extend(match.decode('latin-1') for match in matches)

try:
    with open('media_urls.json', 'r') as f:
        existing_urls = json.load(f)
    urls += existing_urls
except FileNotFoundError:
    pass

seen = set()
unique_urls = []
for url in urls:
    clean_url = normalize_url(url)
    if clean_url not in seen:
        seen.add(clean_url)
        unique_urls.append(clean_url)

# Filter media URLs with corresponding cdn URLs
unique_urls_set = set(unique_urls)
normalized_urls = set()

for url in unique_urls:
    parsed = urlparse(url)
    hostname = parsed.hostname or ''
    normalized_hostname = hostname.lower()
    if parsed.port:
        normalized_netloc = f"{normalized_hostname}:{parsed.port}"
    else:
        normalized_netloc = normalized_hostname
    normalized_parsed = parsed._replace(netloc=normalized_netloc)
    normalized_url = urlunparse(normalized_parsed)
    normalized_urls.add(normalized_url)

filtered_urls = []
for url in unique_urls:
    parsed = urlparse(url)
    hostname = parsed.hostname or ''
    lower_hostname = hostname.lower()
    if lower_hostname.startswith('media.') and lower_hostname.endswith('.net'):
        whatever_part = lower_hostname[6:-4]  # Extract 'whatever' from media.<whatever>.net
        cdn_hostname = f'cdn.{whatever_part}.com'
        if parsed.port:
            new_netloc = f"{cdn_hostname}:{parsed.port}"
        else:
            new_netloc = cdn_hostname
        new_parsed = parsed._replace(netloc=new_netloc)
        cdn_url = urlunparse(new_parsed)
        # Normalize the generated CDN URL for comparison
        parsed_cdn = urlparse(cdn_url)
        cdn_lower_hostname = parsed_cdn.hostname.lower() if parsed_cdn.hostname else ''
        if parsed_cdn.port:
            normalized_cdn_netloc = f"{cdn_lower_hostname}:{parsed_cdn.port}"
        else:
            normalized_cdn_netloc = cdn_lower_hostname
        normalized_cdn_parsed = parsed_cdn._replace(netloc=normalized_cdn_netloc)
        normalized_cdn_url = urlunparse(normalized_cdn_parsed)
        if normalized_cdn_url in normalized_urls:
            continue  # Skip this media URL
    filtered_urls.append(url)

unique_urls = filtered_urls

with open('media_urls.json', 'w') as f:
    json.dump(unique_urls, f, indent=4, ensure_ascii=False)

print(f"Cleaned and deduplicated {len(urls)} URLs to {len(unique_urls)} unique URLs. Saved to media_urls.json")