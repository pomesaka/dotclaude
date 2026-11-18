# xlisten の events/ の 1 行を、モデルが読む短い 1 行にする。watch.sh と stop.sh が使う
if .type == "speech" then
  "voice  \(.from)\(if .speaker then " " + .speaker else "" end): \(.text)"
elif .type == "note" then "note  \(.text)"
elif .type == "error" then "error  \(.message)"
else tojson
end
