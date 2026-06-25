from setuptools import setup, find_packages
import os

setup(
    name="zf3d",
    version="2.0.0",
    description="An all-in-one desktop AI assistant: manage files, browse web, edit documents, generate AI images/videos, automate tasks",
    long_description=open("README.md", encoding="utf-8").read(),
    long_description_content_type="text/markdown",
    author="ZF3D",
    license="MIT",
    url="https://github.com/zf3dzf3dzf3d-ctrl/zf3d_agent",
    classifiers=[
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
        "License :: OSI Approved :: MIT License",
        "Operating System :: Microsoft :: Windows",
        "Operating System :: POSIX :: Linux",
        "Operating System :: MacOS",
        "Natural Language :: Chinese (Simplified)",
        "Topic :: Office/Business",
        "Topic :: Multimedia :: Graphics",
        "Topic :: Internet :: WWW/HTTP :: Browsers",
    ],
    python_requires=">=3.8",
    packages=find_packages(),
    include_package_data=True,
    package_data={
        "": ["*.json", "*.html", "*.css", "*.js", "*.md", "*.bat", "*.sh", "*.png"],
    },
    install_requires=[],
    entry_points={
        "console_scripts": [
            "zf3d=zf3d_cli:main",
        ],
    },
)
