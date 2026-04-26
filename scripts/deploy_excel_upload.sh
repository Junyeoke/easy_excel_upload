#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REACT_DIR="$ROOT_DIR/react/excel/my-excel-app"
WEBAPP_ROOT="/Users/leejunhyuk/apps/egene/webapps/itsm"
EXCEL_ASSET_DIR="$WEBAPP_ROOT/xif/jsp/excel/assets"
JAVA_CLASSES_DIR="$WEBAPP_ROOT/WEB-INF/classes"
JAVA_LIB_DIR="$WEBAPP_ROOT/WEB-INF/lib"
TOMCAT_SERVLET_JAR="/Users/leejunhyuk/apps/egene/apache-tomcat-10.1.18/lib/servlet-api.jar"

echo "[deploy] building Excel frontend"
pushd "$REACT_DIR" >/dev/null
npm run build
popd >/dev/null

echo "[deploy] syncing frontend assets"
mkdir -p "$EXCEL_ASSET_DIR"
cp -f "$REACT_DIR/dist/assets/"* "$EXCEL_ASSET_DIR/"
cp -f "$REACT_DIR/dist/vite.svg" "$WEBAPP_ROOT/xif/jsp/excel/vite.svg"

echo "[deploy] compiling Java sources"
mkdir -p "$JAVA_CLASSES_DIR"
JAVA_CP="$JAVA_CLASSES_DIR:$JAVA_LIB_DIR/*:$TOMCAT_SERVLET_JAR"
find "$ROOT_DIR/controller" "$ROOT_DIR/service" "$ROOT_DIR/repository" "$ROOT_DIR/util" -name '*.java' -print0 \
  | xargs -0 javac -cp "$JAVA_CP" -d "$JAVA_CLASSES_DIR"

echo "[deploy] done"
