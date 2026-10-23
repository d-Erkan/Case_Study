# -*- coding: utf-8 -*-
'''
Random exam seating plan generator.

Modify variables below:
directory
title
exam_name
course_name
date
student_list (+ column indices)
exam_rooms

Usage:
    python3 seating.py

Output (in `directory`):
    seatings.txt   - one line per student: id, room (sorted by id)
    <ROOM>.html    - printable seating plan per room (board at the top)

@author: burakkerim
'''

import csv, html, math, os, random, shutil

directory = 'seating/'
title = 'CENG111 EXAM'
exam_name = 'Exam'
course_name = 'CENG 111'
date = 'DATE / TIME TBD'

# student list exported from the course page (Excel -> "CSV UTF-8"),
# one header line, then one student per line
student_list = 'courseid_5129_participants.csv'
delimiter = ','          # use '\t' for a tab separated copy of the excel file
col_first_name = 0       # column indices (0-based) in the csv
col_last_name = 1
col_id = 2

# optional: file with ids of students allowed - one id per line -
# set check_list = None to seat everybody in student_list
check_list = None        # e.g. 'final_list.txt'

# set to an int (e.g. 403) to get the same plan on every run
random_seed = 5129

# after random filling, move the last N seated students of a room
# to the end of another room: (from_room, to_room, N)
moves = [
    ('BMB4', 'BMB5', 2),
    ('BMB2', 'BMB5', 1),
    ('BMB3', 'BMB5', 1),
]

# rooms used for this exam (order = fill order)
exam_rooms = [
    'BMB1-1',
    'BMB1-2',
    'BMB1-3',
    'BMB2',
    'BMB3',
    'BMB4',
    'BMB5',
]

room_names = {
    'BMB1-1': 'BMB1 - LEFT',
    'BMB1-2': 'BMB1 - MIDDLE',
    'BMB1-3': 'BMB1 - RIGHT',
    'BMB2': 'BMB2',
    'BMB3': 'BMB3',
    'BMB4': 'BMB4',
    'BMB5': 'BMB5',
}

# room: (rows, cols, student list)
rooms = {
    'BMB1-1': (8, 2, []),   # BMB1 total: 16 + 24 + 16 = 56
    'BMB1-2': (8, 3, []),
    'BMB1-3': (8, 2, []),
    'BMB2': (8, 4, []),     # 32
    'BMB3': (8, 4, []),     # 32
    'BMB4': (6, 5, []),     # 30
    'BMB5': (5, 5, []),     # 25
}

for room in exam_rooms:
    assert room in rooms, 'No layout for room %s' % room
    assert room in room_names, 'No display name for room %s' % room

# allowed ids
check = None
if check_list:
    with open(check_list, 'r', encoding='utf-8-sig') as c:
        check = set(line.strip() for line in c if line.strip())

# id: (name, room)
students = {}
with open(student_list, 'r', encoding='utf-8-sig', newline='') as std_list:
    reader = csv.reader(std_list, delimiter=delimiter)
    # skip header line
    next(reader)
    for row in reader:
        if not row or not any(cell.strip() for cell in row):
            continue
        sid = row[col_id].strip()
        name = row[col_first_name].strip() + ' ' + row[col_last_name].strip()
        if not sid:
            print('WARNING: no id, skipped:', name)
            continue
        if sid in students:
            print('WARNING: duplicate id', sid, '-', name)
            continue
        if check is not None and sid not in check:
            continue
        students[sid] = (name, '')

if check is not None:
    for sid in sorted(check):
        if sid not in students:
            print(sid, 'not found in student list')

capacity = sum(rooms[r][0] * rooms[r][1] for r in exam_rooms)

print('capacity:', capacity, 'students:', len(students))

assert len(students) > 0, 'No students read from %s' % student_list
assert capacity >= len(students), 'Not enough capacity'

load_factor = 1.0 * len(students) / capacity

# shuffle students
if random_seed is not None:
    random.seed(random_seed)
keys = list(students.keys())
random.shuffle(keys)
sids = iter(keys)

# fill each room proportionally to its size, so empty seats are spread
# over all rooms (last room gets the remainder)
for room in exam_rooms:
    quota = int(math.ceil(rooms[room][0] * rooms[room][1] * load_factor))
    for sid in sids:
        rooms[room][2].append(sid)
        students[sid] = (students[sid][0], room)
        if len(rooms[room][2]) >= quota:
            break

# manual adjustments
for src, dst, n in moves:
    for sid in rooms[src][2][-n:]:
        rooms[src][2].remove(sid)
        rooms[dst][2].append(sid)
        students[sid] = (students[sid][0], dst)
        assert len(rooms[dst][2]) <= rooms[dst][0] * rooms[dst][1], \
            'Not enough seats in %s' % dst

# check rooms
number_of_students_in_rooms = 0
for room in exam_rooms:
    number_of_students_in_rooms += len(rooms[room][2])
    print(len(rooms[room][2]), '/', rooms[room][0] * rooms[room][1], room)

print(number_of_students_in_rooms, 'students in rooms')

assert number_of_students_in_rooms == len(students), \
    'Numbers don\'t match %d %d' % (number_of_students_in_rooms, len(students))

# create a fresh output folder
shutil.rmtree(directory, ignore_errors=True)
os.makedirs(directory)

# write student exam rooms
with open(os.path.join(directory, 'seatings.txt'), 'w', encoding='utf-8') as seatings:
    for sid in sorted(students):
        seatings.write(sid + ' ' + str(students[sid][1]).ljust(6) + '\n')

# print seating plans
for room in exam_rooms:
    n_rows, n_cols, room_sids = rooms[room]
    width = 100.0 / n_cols
    height = 90.0 / n_rows

    out = open(os.path.join(directory, room + '.html'), 'w', encoding='utf-8')
    out.write('<html>\n\
        <head>\n\
        <style>\n\
        table {\n\
            border: 1px solid black; border-collapse:collapse;\n\
        }\n\
        td {\n\
            border: 1px solid black;\n\
        }\n\
        h4, h6{\n\
            margin:3px;\n\
            padding:3px;\n\
        }\n\
        </style>\n\
        <meta http-equiv="Content-Type" content="text/html; charset=utf-8">\n\
        <title>' + html.escape(title) + '</title>\n\
        </head>\n\
        <body>\n\
        <table width="100%" height="100%">\n\
        <tr height="10%">\n\
        <th colspan="' + str(n_cols) + '">\n\
        <h4 align="center">' + html.escape(course_name) + '</h4>\n\
        <h4 align="center">' + html.escape(exam_name) + '</h4>\n\
        <h6 align="center"><i>' + html.escape(date) + '</i></h6>\n\
        <h3 align="center"> ' + html.escape(room_names[room]) + '</h3>\n\
        <h4 align="center"><b> BOARD </b></h4>\n\
        </tr>\n\n')

    for i in range(n_rows):
        out.write('<tr height="' + '{0:.2f}'.format(height) + '%">\n')
        for j in range(n_cols):
            k = i * n_cols + j
            if k < len(room_sids):
                sid = room_sids[k]
                text = html.escape(students[sid][0]) + ' <br> ' + html.escape(sid)
            else:
                text = ' <br> '
            out.write('<td align="center" valign="top" width="'
                      + '{0:.2f}'.format(width) + '%"> '
                      + '<div style="font-size:11px"> ' + text + ' </div> '
                      + '</td>\n')
        out.write('</tr>\n\n')

    out.write('</table>\n\
        </body>\n\
        </html>\n')
    out.close()
