#!/usr/bin/env python3
"""Import the daily basic verb notes without editing the source vault."""
import argparse
import json
import re
from pathlib import Path


def parse_day(path):
    text = re.sub(r'^<a id="[^"]+"></a>\s*$', '', path.read_text(), flags=re.M)
    day = int(path.stem.split('-')[1])
    items, introductions = [], []
    for section in re.split(r'^## ', text, flags=re.M)[1:]:
        heading, _, body = section.partition('\n')
        verb = heading.split()[0]
        pieces = re.split(r'^### ', body, flags=re.M)
        introductions.append({'verb': verb, 'text': pieces[0].strip()})
        for piece in pieces[1:]:
            label, _, detail = piece.partition('\n')
            item_id, title = label.split(' · ', 1)
            definition = re.search(r'^\*\*(.+)\*\*$', detail, re.M)
            tier = re.search(r'미국 회화 티어: \*\*([123])티어\*\* · 판단 근거: (.+)', detail)
            if not definition or not tier:
                raise ValueError(f'{path.name}: missing definition or tier for {item_id}')
            pattern, sources, examples, notes = '', '', [], []
            for line in detail.splitlines():
                line = line.strip()
                if not line or line == definition.group(0) or '미국 회화 티어:' in line:
                    continue
                if line.startswith('- 문형:'):
                    pattern = line.removeprefix('- 문형: ').strip()
                elif line.startswith('- 예문'):
                    examples.append(line[2:])
                elif line.startswith('- 출처:'):
                    sources = line.removeprefix('- 출처: ').strip()
                else:
                    notes.append(line)
            if not all((definition, tier, pattern, sources, examples)):
                raise ValueError(f'{path.name}: incomplete item {item_id}')
            items.append(dict(id=item_id, title=title, verb=verb,
                              definition=definition.group(1), tier=int(tier.group(1)),
                              rationale=tier.group(2), pattern=pattern, sources=sources,
                              examples=examples, notes='\n'.join(notes)))
    return dict(day=day, items=items, introductions=introductions,
                verbs=list(dict.fromkeys(item['verb'] for item in items)))


def write_page(destination, relative, metadata, body=''):
    path = destination / 'content/study' / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    frontmatter = json.dumps(metadata, ensure_ascii=False, indent=2)
    path.write_text(frontmatter + ('\n\n' + body.strip() if body.strip() else '') + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=Path, help='998_eng/basic_verbs directory')
    parser.add_argument('--destination', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    paths = sorted((args.source / 'basic-verbs-days').glob('day-*.md'))
    days = [parse_day(path) for path in paths]
    if len(days) != 14 or [d['day'] for d in days] != list(range(1, 15)):
        raise ValueError('Expected day-01.md through day-14.md')
    ids = [item['id'] for day in days for item in day['items']]
    if len(ids) != len(set(ids)):
        raise ValueError('Duplicate study item IDs')
    data_path = args.destination / 'data/study/basic_verbs.json'
    data_path.parent.mkdir(parents=True, exist_ok=True)
    data_path.write_text(json.dumps(days, ensure_ascii=False, indent=2) + '\n')
    write_page(args.destination, '_index.md', dict(title='Study', type='study',
               description='하루씩 읽고, 말하고, 다시 확인하는 학습 노트.'))
    write_page(args.destination, 'basic-verbs/_index.md', dict(title='Basic verbs',
               type='study', course='basic-verbs', description='GET · HAVE · TAKE · DO · MAKE · KEEP'))
    for day in days:
        write_page(args.destination, f'basic-verbs/day-{day["day"]:02}/index.md',
                   dict(title=f'Basic verbs · {day["day"]}일차', type='study',
                        day=day['day'], weight=day['day'], lang='ko', searchHidden=True),
                   '\n\n'.join(f'### {i["id"]} · {i["title"]}\n\n{i["definition"]}' for i in day['items']))
    readme = (args.source / 'README.md').read_text()
    guide = readme.split('## 읽는 법\n', 1)[1].split('\n## ', 1)[0]
    guide += '\n\n## 학습 우선순위\n\n1티어는 핵심 발화, 2티어는 상황별 발화, 3티어는 이해·참고를 우선합니다. '
    guide += '티어는 미국 일상·일반 직장 회화를 위한 편집 판단이며 실측 빈도 순위나 사전 공식 등급이 아닙니다.\n'
    guide += '\n## 자료 범위\n\n이 과정은 기본 뜻·문형·주요 연어 285항목을 원본 순서대로 14일로 나눈 자료입니다. '
    guide += '조사일: 2026-09-26. 구동사·관용표현 과정은 포함하지 않습니다. '
    guide += '각 항목의 사전 출처와 사용역 표시를 함께 확인하세요.\n\n[14일 목차로 돌아가기](/study/basic-verbs/)'
    write_page(args.destination, 'basic-verbs/guide/index.md', dict(title='Basic verbs · 읽는 법', type='page',
               lang='ko', searchHidden=True, ShowReadingTime=False, ShowPostNavLinks=False), guide)
    print(f'Imported {len(days)} days / {len(ids)} items into {args.destination}')


if __name__ == '__main__':
    main()
